<script lang="ts">
	import { onMount } from 'svelte';
	import { DEFAULT_CLUSTER_THRESHOLD } from '$lib/constants';
	import type { Bug, Cluster, IntakeType, Severity, Status } from '$lib/schemas';
	import { clusterLocal, labelTokens } from '$lib/cluster-text';
	import { matchesFilters, freqRank, toggleInSet, emptyFilterState } from '$lib/filter-helpers';
	import { computeHotCounts, computeHighlightedClusterIds, type HighlightKind } from '$lib/cluster-views';
	import { parseSonarUrlState, writeSonarUrlToLocation } from '$lib/url-sync';
	import { makeBugActions } from '$lib/bug-actions';
	import { makeSplitDragHandlers, SPLIT_MIN, SPLIT_MAX } from './components/split-drag';
	import { makeDrillHandlers, MAX_DRILL_DEPTH } from './components/drill-actions';
	import { restoreLocalPrefs, lockDocumentOverflow } from './components/page-prefs';
	import BubbleViz from './components/BubbleViz.svelte';
	import LogBugModal from './components/LogBugModal.svelte';
	import ClusterPanel from './components/ClusterPanel.svelte';
	import FiltersMenu from './components/FiltersMenu.svelte';
	import DrillBreadcrumb from './components/DrillBreadcrumb.svelte';
	import InlineFiltersBar from './components/InlineFiltersBar.svelte';
	import SonarHeader from './components/SonarHeader.svelte';
	import '$lib/styles/sonar.css';

	let bugs = $state<Bug[]>([]);
	let archivedBugs = $state<Bug[]>([]);
	let clusters = $state<Cluster[]>([]);
	let threshold = $state(DEFAULT_CLUSTER_THRESHOLD);
	let mode = $state<'local' | 'ai'>('local');
	let loading = $state(true);
	let errorMsg = $state<string | null>(null);

	// Sentinel id for the synthetic Archive cluster (right panel only).
	const ARCHIVE_ID = '__archive';

	// Filter state. Single-select uses '' as unset; multi-select uses Set.
	let sourceFilter = $state<'' | 'internal' | 'public' | 'slack'>('');
	let areaFilter = $state<string>('');
	let searchText = $state('');
	let severityFilter = $state<Set<Severity>>(new Set());
	let statusFilter = $state<Set<Status>>(new Set());
	let intakeTypeFilter = $state<Set<IntakeType>>(new Set());
	let reporterFilter = $state<Set<string>>(new Set());
	let responderFilter = $state<Set<string>>(new Set());
	let assigneeFilter = $state<Set<string>>(new Set());
	let useAi = $state(false);
	let selectedId = $state<string | null>(null);
	let showModal = $state(false);
	let showFilters = $state(false);
	let theme = $state<'light' | 'dark'>('light');

	// Drill-down state. drillPath is the stack of parent clusters; depth 0 = top.
	// zoomingId is set during the ~420ms zoom-in animation; the page commits
	// the drill (pushes drillPath) when it clears. See onBubbleClick().
	let drillPath = $state<Cluster[]>([]);
	let zoomingId = $state<string | null>(null);
	let zoomingBackToId = $state<string | null>(null);
	// Hover-sync set: cluster ids the right-panel lists are pointing at,
	// rendered as a spotlight on the left. Empty = no sync.
	let highlightedIds = $state<Set<string>>(new Set());
	// Bug to scroll-to + flash after a Recently-filed click. Auto-clears.
	let focusBugId = $state<string | null>(null);

	// Two-column split: bubble-viz width fraction. Handlers in split-drag.ts.
	let splitRatio = $state(0.58);
	let isDragging = $state(false);
	let layoutEl: HTMLDivElement | null = $state(null);
	const splitDrag = makeSplitDragHandlers({
		getRatio: () => splitRatio,
		setRatio: (r) => (splitRatio = r),
		getLayoutEl: () => layoutEl,
		setDragging: (b) => (isDragging = b),
		isDragging: () => isDragging
	});

	// Filters-button badge: one count per active dimension, not per entry.
	const activeFilterCount = $derived(
		(sourceFilter ? 1 : 0) +
		(areaFilter ? 1 : 0) +
		(searchText.trim() ? 1 : 0) +
		(severityFilter.size > 0 ? 1 : 0) +
		(statusFilter.size > 0 ? 1 : 0) +
		(intakeTypeFilter.size > 0 ? 1 : 0) +
		(reporterFilter.size > 0 ? 1 : 0) +
		(responderFilter.size > 0 ? 1 : 0) +
		(assigneeFilter.size > 0 ? 1 : 0) +
		(Math.abs(threshold - DEFAULT_CLUSTER_THRESHOLD) > 0.001 ? 1 : 0) +
		(useAi ? 1 : 0)
	);

	// Current drill parent — the cluster the user has zoomed into (last entry
	// on the drillPath stack). Null at the top level.
	const currentParent = $derived(drillPath.length > 0 ? drillPath[drillPath.length - 1] : null);

	// Bugs in scope: top level applies filters; drilled levels use the
	// parent's bug subset (no re-filter — would silently empty mid-drill).
	const displayBugs = $derived.by(() => {
		if (currentParent) {
			const ids = new Set(currentParent.bugIds);
			return bugs.filter((b) => ids.has(b._id));
		}
		return bugs.filter((b) =>
			matchesFilters(b, {
				searchText, sourceFilter, areaFilter,
				severityFilter, statusFilter, intakeTypeFilter,
				reporterFilter, responderFilter, assigneeFilter
			})
		);
	});

	// Clusters at current depth. Top: server result projected onto visible
	// bugs so filter changes re-render without re-fetching. Deeper: local
	// re-cluster of the parent's bugs at a stricter threshold; tokens
	// already in drill-path labels are excluded so sub-labels show
	// what's NEW at this depth.
	const displayClusters = $derived.by(() => {
		if (drillPath.length === 0) {
			const visibleIds = new Set(displayBugs.map((b) => b._id));
			return clusters
				.map((c) => ({ ...c, bugIds: c.bugIds.filter((id) => visibleIds.has(id)) }))
				.filter((c) => c.bugIds.length > 0);
		}
		const excludes = new Set<string>();
		drillPath.forEach((p) => labelTokens(p).forEach((t) => excludes.add(t)));
		const depth = drillPath.length;
		const stricter = Math.min(0.7, threshold + 0.05 * depth);
		return clusterLocal(displayBugs, stricter, excludes);
	});

	// Re-cluster a cluster's bugs at the next threshold to check if it
	// splits ≥2 ways. Non-splittable = leaf. Returns up to 6 subClusters
	// for BubbleViz preview pips.
	function peekDrill(c: Cluster): { drillable: boolean; subClusters: Cluster[] } {
		if (drillPath.length >= MAX_DRILL_DEPTH || c.bugIds.length <= 1) {
			return { drillable: false, subClusters: [] };
		}
		const childBugs = c.bugIds.map((bid) => bugs.find((b) => b._id === bid)).filter(Boolean) as Bug[];
		const excludes = new Set<string>();
		drillPath.forEach((p) => labelTokens(p).forEach((t) => excludes.add(t)));
		labelTokens(c).forEach((t) => excludes.add(t));
		const depth = drillPath.length + 1;
		const stricter = Math.min(0.7, threshold + 0.05 * depth);
		const peek = clusterLocal(childBugs, stricter, excludes).filter((x) => x.bugIds.length > 0);
		return { drillable: peek.length >= 2, subClusters: peek.slice(0, 6) };
	}

	// Current-depth clusters annotated with drillability + sub-cluster preview.
	const annotatedClusters = $derived(
		displayClusters.map((c) => {
			const p = peekDrill(c);
			return { ...c, drillable: p.drillable, subClusters: p.subClusters };
		})
	);

	const selectedCluster = $derived(displayClusters.find((c) => c.id === selectedId) ?? null);
	// Synthetic Archive cluster — selecting it routes the panel into
	// archive-mode without touching the bubble view.
	const archiveCluster = $derived<Cluster>({
		id: ARCHIVE_ID,
		label: 'Archived bugs',
		primaryArea: '',
		areas: [],
		severity: 'low',
		bugIds: archivedBugs.map((b) => b._id)
	});
	const isArchiveSelected = $derived(selectedId === ARCHIVE_ID);
	// Right-panel target: archive selection > cluster selection > drill parent.
	const panelTarget = $derived(isArchiveSelected ? archiveCluster : (selectedCluster ?? currentParent));
	const panelMode = $derived<'cluster' | 'archive'>(isArchiveSelected ? 'archive' : 'cluster');
	// Panel needs archived bugs by id in archive mode (they're not in `bugs`).
	const allBugsForPanel = $derived(isArchiveSelected ? [...bugs, ...archivedBugs] : bugs);

	const visibleBugCount = $derived(displayBugs.length);
	const taggedAreaCount = $derived(new Set(displayBugs.flatMap((b) => b.areas)).size);
	const nonSingleton = $derived(displayClusters.filter((c) => c.bugIds.length > 1).length);

	// Hot = ≥1 unresolved high-severity bug — drives the radar pulse +
	// numeric badge. See lib/cluster-views.ts.
	const hotCounts = $derived(computeHotCounts(displayClusters, bugs));
	const clusterIsHot = $derived((c: Cluster): boolean => hotCounts.has(c.id));
	// People-picker options, frequency-ranked from the full bug set.
	const reporterOptions = $derived(freqRank(bugs.map((b) => b.reporter)));
	const responderOptions = $derived(freqRank(bugs.flatMap((b) => b.responders ?? [])));
	const assigneeOptions = $derived(freqRank(bugs.map((b) => b.assignee ?? '')));
	const hasUnassignedBugs = $derived(bugs.some((b) => !b.assignee));

	const sortedClusters = $derived(
		[...displayClusters].sort((a, b) => {
			const ha = clusterIsHot(a) ? 1 : 0;
			const hb = clusterIsHot(b) ? 1 : 0;
			if (ha !== hb) return hb - ha;
			return b.bugIds.length - a.bugIds.length;
		})
	);
	const hotIds = $derived(new Set(hotCounts.keys()));

	async function load() {
		loading = true;
		errorMsg = null;
		try {
			const params = new URLSearchParams({ threshold: String(threshold) });
			if (useAi) params.set('ai', 'true');
			const r = await fetch(`/api/cluster?${params}`);
			if (!r.ok) throw new Error(`Cluster fetch ${r.status}`);
			const data = await r.json();
			// Store the un-filtered bug + cluster sets; displayBugs and
			// displayClusters project them through the live filter state on
			// every change, so load() only re-fires for threshold/AI changes
			// (which alter the server's clustering).
			bugs = data.bugs;
			archivedBugs = (data.archivedBugs ?? []) as Bug[];
			clusters = data.clusters as Cluster[];
			mode = data.mode;
			// Cluster ids regenerate every fetch — reset drill + selection.
			drillPath = [];
			zoomingId = null;
			selectedId = null;
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Failed to load.';
		} finally {
			loading = false;
		}
	}

	function onBugSaved() {
		showModal = false;
		load();
	}

	// Drill-down navigation. State stays here; the zoom→commit / pop→reverse-zoom
	// choreography lives in drill-actions.ts (same getter/setter pattern as the
	// split-drag + bug-action factories above).
	const drill = makeDrillHandlers({
		getAnnotatedClusters: () => annotatedClusters,
		getDrillPath: () => drillPath,
		setDrillPath: (p) => (drillPath = p),
		setSelectedId: (id) => (selectedId = id),
		setZoomingId: (id) => (zoomingId = id),
		setZoomingBackToId: (id) => (zoomingBackToId = id)
	});

	function setHighlight(kind: HighlightKind, value?: string) {
		highlightedIds = computeHighlightedClusterIds(kind, value, displayClusters);
	}

	// Archive / unarchive handlers — PATCH archived=true|false then reload.
	const bugActions = makeBugActions({
		reload: () => load(),
		setError: (m) => (errorMsg = m)
	});

	// Recently-filed row click: select cluster + mark bug for scroll/flash.
	function openBugFromOverview(bugId: string) {
		const c = displayClusters.find((x) => x.bugIds.includes(bugId));
		if (!c) return;
		selectedId = c.id;
		focusBugId = bugId;
		setTimeout(() => { focusBugId = null; }, 1700);
	}

	function clearAllFilters() {
		const e = emptyFilterState();
		searchText = e.searchText; sourceFilter = e.sourceFilter; areaFilter = e.areaFilter;
		severityFilter = e.severityFilter; statusFilter = e.statusFilter;
		intakeTypeFilter = e.intakeTypeFilter;
		reporterFilter = e.reporterFilter; responderFilter = e.responderFilter; assigneeFilter = e.assigneeFilter;
	}

	// Reset a single multi-select dimension (the "Clear X" footer button
	// inside each InlineMultiPicker popover).
	function clearDimension(kind: 'severity' | 'status' | 'intakeType' | 'reporter' | 'responder' | 'assignee') {
		if (kind === 'severity') severityFilter = new Set();
		else if (kind === 'status') statusFilter = new Set();
		else if (kind === 'intakeType') intakeTypeFilter = new Set();
		else if (kind === 'reporter') reporterFilter = new Set();
		else if (kind === 'responder') responderFilter = new Set();
		else if (kind === 'assignee') assigneeFilter = new Set();
	}

	function toggleTheme() {
		theme = theme === 'light' ? 'dark' : 'light';
		try { localStorage.setItem('sonar.theme', theme); } catch (e) { console.warn('[sonar] localStorage unavailable', e); }
	}

	onMount(() => {
		const prefs = restoreLocalPrefs();
		if (prefs.theme) theme = prefs.theme;
		if (prefs.splitRatio !== null) splitRatio = prefs.splitRatio;

		// Apply ?q / ?severity / ?bug / etc. BEFORE load() so the first
		// cluster fetch already sees the right threshold + ai mode. The
		// bug-focus + archive-view land after load() resolves (they need
		// the bug list).
		const url = parseSonarUrlState(new URL(window.location.href).searchParams);
		if (url.searchText) searchText = url.searchText;
		if (url.sourceFilter) sourceFilter = url.sourceFilter;
		if (url.areaFilter) areaFilter = url.areaFilter;
		if (url.severityFilter) severityFilter = url.severityFilter;
		if (url.statusFilter) statusFilter = url.statusFilter;
		if (url.intakeTypeFilter) intakeTypeFilter = url.intakeTypeFilter;
		if (url.reporterFilter) reporterFilter = url.reporterFilter;
		if (url.responderFilter) responderFilter = url.responderFilter;
		if (url.assigneeFilter) assigneeFilter = url.assigneeFilter;
		if (url.useAi) useAi = url.useAi;
		if (url.threshold !== undefined) threshold = url.threshold;

		load().then(() => {
			if (url.archiveView) selectedId = ARCHIVE_ID;
			else if (url.bugId) openBugFromOverview(url.bugId);
		});

		return lockDocumentOverflow();
	});

	// Mirror the current filter / view state into the address bar via
	// history.replaceState. Reads as soon as any tracked state changes
	// thanks to Svelte 5's auto-tracking. Skipped on the server.
	$effect(() => {
		writeSonarUrlToLocation({
			searchText, sourceFilter, areaFilter,
			severityFilter, statusFilter, intakeTypeFilter,
			reporterFilter, responderFilter, assigneeFilter,
			useAi, threshold,
			defaultThreshold: DEFAULT_CLUSTER_THRESHOLD,
			archiveView: isArchiveSelected
		});
	});
</script>

<svelte:head>
	<title>Sonar — bug & feedback radar</title>
</svelte:head>

<div class="sonar-root" data-theme={theme}>
	<SonarHeader
		{mode} {theme} {visibleBugCount} {nonSingleton} {taggedAreaCount} {activeFilterCount}
		onToggleFilters={() => (showFilters = !showFilters)}
		onToggleTheme={toggleTheme}
		onLogBug={() => (showModal = true)}
	/>

	<InlineFiltersBar
		{searchText} {sourceFilter} {areaFilter}
		{severityFilter} {statusFilter} {intakeTypeFilter}
		{reporterFilter} {responderFilter} {assigneeFilter}
		{reporterOptions} {responderOptions} {assigneeOptions}
		{hasUnassignedBugs}
		{activeFilterCount}
		onSetSearch={(v) => (searchText = v)}
		onSetArea={(v) => (areaFilter = v)}
		onSetSource={(v) => (sourceFilter = v)}
		onToggleSeverity={(v) => (severityFilter = toggleInSet(severityFilter, v))}
		onToggleStatus={(v) => (statusFilter = toggleInSet(statusFilter, v))}
		onToggleIntakeType={(v) => (intakeTypeFilter = toggleInSet(intakeTypeFilter, v))}
		onToggleReporter={(v) => (reporterFilter = toggleInSet(reporterFilter, v))}
		onToggleResponder={(v) => (responderFilter = toggleInSet(responderFilter, v))}
		onToggleAssignee={(v) => (assigneeFilter = toggleInSet(assigneeFilter, v))}
		onClearAll={clearAllFilters}
		onClearDimension={clearDimension}
	/>

	<div bind:this={layoutEl} class="sonar-main max-w-7xl w-full mx-auto px-6 py-4" style="gap: 0;">
		<!-- Left panel fills the available height; bubble viz lives inside flex-1 + min-h-0. -->
		<section class="sonar-panel rounded-lg p-4 flex flex-col h-full min-h-0" style="flex: {splitRatio} 1 0; min-width: 280px;">
			<div class="flex justify-between items-center mb-3 shrink-0">
				<div>
					<div class="text-base font-medium sonar-text">Cluster map</div>
					<div class="text-xs sonar-muted">Bubbles sized by # of bugs · lines connect clusters sharing feature areas</div>
					<DrillBreadcrumb {drillPath} onJump={drill.drillJump} onReset={drill.drillReset} />
				</div>
				<button onclick={load} class="text-xs px-3 py-1 border sonar-divider rounded hover:bg-black/5 dark:hover:bg-white/5">Reload</button>
			</div>
			<div class="flex-1 min-h-0 flex flex-col">
				{#if loading}
					<div class="flex-1 flex items-center justify-center">
						<div class="animate-spin h-6 w-6 border-2 border-[#4a1ee3]/30 border-t-[#4a1ee3] rounded-full"></div>
					</div>
				{:else if errorMsg}
					<div class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 px-3 py-2 rounded text-sm">
						Couldn't load clusters: {errorMsg}
						<button onclick={load} class="ml-2 underline">Retry</button>
					</div>
				{:else if displayClusters.length === 0}
					<div class="flex-1 flex items-center justify-center text-center sonar-muted">
						<div>
							<div class="text-sm">No bugs match the current filters.</div>
							<div class="text-xs mt-1">Open the Filters menu and loosen the source or area filter.</div>
						</div>
					</div>
				{:else}
					<BubbleViz
						clusters={annotatedClusters}
						{selectedId}
						{theme}
						{hotCounts}
						{highlightedIds}
						parent={currentParent}
						{zoomingId}
						{zoomingBackToId}
						archivedCount={archivedBugs.length}
						archiveActive={isArchiveSelected}
						onArchiveBug={bugActions.archive}
						onSelectArchive={() => (selectedId = ARCHIVE_ID)}
						onSelect={drill.onBubbleClick}
						onDrillBack={drill.drillBack}
					/>
				{/if}
			</div>
		</section>

		<!-- Resize handle. role=separator + tabindex per WAI ARIA APG. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="sonar-split-handle"
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize panels"
			aria-valuenow={Math.round(splitRatio * 100)}
			aria-valuemin={Math.round(SPLIT_MIN * 100)}
			aria-valuemax={Math.round(SPLIT_MAX * 100)}
			tabindex="0"
			class:sonar-split-handle-active={isDragging}
			onpointerdown={splitDrag.onPointerDown}
			onpointermove={splitDrag.onPointerMove}
			onpointerup={splitDrag.onPointerUp}
			onpointercancel={splitDrag.onPointerUp}
			onkeydown={splitDrag.onKeyDown}
		>
			<div class="sonar-split-grip"></div>
		</div>
		<aside class="sonar-panel rounded-lg p-4" style="flex: {1 - splitRatio} 1 0; min-width: 280px; height: 100%; overflow-y: auto;">
			<ClusterPanel
				cluster={panelTarget}
				bugs={allBugsForPanel}
				{sortedClusters}
				{hotIds}
				{drillPath}
				{focusBugId}
				mode={panelMode}
				onMutated={load}
				onSelectCluster={drill.onBubbleClick}
				onDrillJump={drill.drillJump}
				onDrillReset={drill.drillReset}
				onHover={setHighlight}
				onOpenBug={openBugFromOverview}
				onArchive={bugActions.archive}
				onUnarchive={bugActions.unarchive}
			/>
		</aside>
	</div>

	{#if showFilters}
		<FiltersMenu
			{threshold}
			{useAi}
			{sortedClusters}
			{hotIds}
			{selectedId}
			onSetThreshold={(n) => (threshold = n)}
			onSetUseAi={(v) => (useAi = v)}
			onReload={load}
			onSelectCluster={(id) => (selectedId = id)}
			onClose={() => (showFilters = false)}
		/>
	{/if}
</div>

{#if showModal}
	<LogBugModal {theme} onClose={() => (showModal = false)} onSaved={onBugSaved} />
{/if}

