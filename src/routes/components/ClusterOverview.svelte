<script lang="ts">
	import type { Bug, Cluster } from '$lib/schemas';
	import { FEATURE_AREAS } from '$lib/constants';

	type Props = {
		bugs: Bug[];
		sortedClusters: Cluster[];
		hotIds: Set<string>;
		onSelectCluster: (id: string) => void;
		// Fires as the cursor enters / leaves an item. The page resolves
		// the kind+value to a set of cluster ids to highlight on the left.
		onHover?: (kind: 'cluster' | 'area' | 'bug' | null, value?: string) => void;
		// Click on a Recently-filed bug row. If wired, the page selects the
		// bug's cluster AND scrolls/flashes that specific bug card so the
		// user lands on what they clicked (not just somewhere in the cluster).
		// Falls back to plain cluster-select when omitted.
		onOpenBug?: (bugId: string) => void;
	};
	let { bugs, sortedClusters, hotIds, onSelectCluster, onHover, onOpenBug }: Props = $props();

	// Tiny wrappers so the markup stays readable. `onHover?.()` does
	// nothing when no parent wired the prop, which keeps the component
	// usable in contexts without sync.
	const enterCluster = (id: string) => onHover?.('cluster', id);
	const enterArea = (a: string) => onHover?.('area', a);
	const enterBug = (id: string) => onHover?.('bug', id);
	const leave = () => onHover?.(null);

	// Mirrors BubbleViz PALETTE — reds removed so red is reserved for hot.
	const PALETTE = ['#4a1ee3', '#f59e0b', '#a855f7', '#64748b', '#22c55e', '#06b6d4', '#fb923c', '#ec4899', '#eab308', '#10b981', '#6366f1', '#14b8a6'];
	const colorFor = (area: string): string => {
		const i = FEATURE_AREAS.indexOf(area as never);
		return i >= 0 ? PALETTE[i % PALETTE.length] : '#94a3b8';
	};

	const sevColors = {
		high: { fg: '#dc2626', bg: 'rgba(220, 38, 38, 0.08)' },
		medium: { fg: '#d97706', bg: 'rgba(217, 119, 6, 0.08)' },
		low: { fg: '#059669', bg: 'rgba(5, 150, 105, 0.08)' }
	};

	const SLACK_USER_ID_RE = /^U[A-Z0-9]{6,}$/;
	const displayReporter = (raw: string | undefined): string => {
		if (!raw) return 'Anonymous';
		if (SLACK_USER_ID_RE.test(raw)) return 'Slack user';
		return raw;
	};
	const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

	const totalBugs = $derived(bugs.length);
	const nonSingletonClusters = $derived(sortedClusters.filter((c) => c.bugIds.length > 1));
	const hotClusters = $derived(sortedClusters.filter((c) => hotIds.has(c.id)));
	const topClusters = $derived(sortedClusters.slice(0, 6));
	const areaCounts = $derived.by(() => {
		const m: Record<string, number> = {};
		for (const b of bugs) for (const a of b.areas) m[a] = (m[a] || 0) + 1;
		return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6);
	});
	const recentBugs = $derived(
		[...bugs]
			.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
			.slice(0, 4)
	);

	// Resolve a bug id → cluster id so clicking a Recently-filed row jumps
	// the right panel to the cluster detail view (where description,
	// assignee, slack threads, etc. all live). Falls back to null if the
	// bug isn't in any of the visible clusters (filtered out, etc.).
	function clusterIdForBug(bugId: string): string | null {
		const c = sortedClusters.find((x) => x.bugIds.includes(bugId));
		return c?.id ?? null;
	}
	function openBug(bugId: string) {
		if (onOpenBug) { onOpenBug(bugId); return; }
		const cid = clusterIdForBug(bugId);
		if (cid) onSelectCluster(cid);
	}
</script>

<div class="flex flex-col gap-4">
	<div>
		<div class="text-xs sonar-muted uppercase tracking-wider">Overview</div>
		<div class="mt-1 text-base sonar-text">
			<span class="font-medium">{totalBugs}</span>
			<span class="sonar-muted">bug{totalBugs === 1 ? '' : 's'} across</span>
			<span class="font-medium">{nonSingletonClusters.length}</span>
			<span class="sonar-muted">cluster{nonSingletonClusters.length === 1 ? '' : 's'}</span>
			{#if hotClusters.length > 0}
				<span class="sonar-muted"> · </span>
				<span style="color: #ef4444;">{hotClusters.length} hot</span>
			{/if}
		</div>
		<div class="text-xs sonar-muted mt-1">Click a bubble on the left, or pick a cluster below to dig in.</div>
	</div>

	{#if hotClusters.length > 0}
		<div>
			<div class="text-xs uppercase tracking-wider sonar-muted mb-2">Hot right now</div>
			<div class="flex flex-col gap-1">
				{#each hotClusters.slice(0, 4) as c (c.id)}
					<button
						onclick={() => onSelectCluster(c.id)}
						onmouseenter={() => enterCluster(c.id)}
						onmouseleave={leave}
						onfocus={() => enterCluster(c.id)}
						onblur={leave}
						class="sonar-row text-left text-sm px-2 py-1.5 rounded flex justify-between items-center gap-2"
					>
						<span aria-hidden="true" class="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style="background: #ef4444; box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.18);"></span>
						<span class="truncate flex-1">{c.label}</span>
						<span class="text-xs sonar-muted">{c.bugIds.length}</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}

	{#if topClusters.length > 0}
		<div>
			<div class="text-xs uppercase tracking-wider sonar-muted mb-2">Largest clusters</div>
			<div class="flex flex-col gap-1">
				{#each topClusters as c (c.id)}
					<button
						onclick={() => onSelectCluster(c.id)}
						onmouseenter={() => enterCluster(c.id)}
						onmouseleave={leave}
						onfocus={() => enterCluster(c.id)}
						onblur={leave}
						class="sonar-row text-left text-sm px-2 py-1.5 rounded flex justify-between items-center gap-2"
					>
						{#if hotIds.has(c.id)}
							<span aria-hidden="true" class="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style="background: #ef4444; box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.18);"></span>
						{:else}
							<span aria-hidden="true" class="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style="background: var(--sonar-border);"></span>
						{/if}
						<span class="truncate flex-1">{c.label}</span>
						<span class="text-xs sonar-muted">{c.bugIds.length}</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}

	{#if areaCounts.length > 0}
		<div>
			<div class="text-xs uppercase tracking-wider sonar-muted mb-2">Top areas</div>
			<div class="flex flex-wrap gap-1">
				{#each areaCounts as [area, n] (area)}
					<span
						role="presentation"
						onmouseenter={() => enterArea(area)}
						onmouseleave={leave}
						class="text-xs px-2 py-0.5 rounded-full border inline-flex items-center gap-1 cursor-default"
						style="color: {colorFor(area)}; border-color: {colorFor(area)}66; background: {colorFor(area)}0d;"
					>
						{area}
						<span class="opacity-70">· {n}</span>
					</span>
				{/each}
			</div>
		</div>
	{/if}

	{#if recentBugs.length > 0}
		<div>
			<div class="text-xs uppercase tracking-wider sonar-muted mb-2">Recently filed</div>
			<div class="flex flex-col gap-1.5">
				{#each recentBugs as b (b._id)}
					<button
						type="button"
						onclick={() => openBug(b._id)}
						onmouseenter={() => enterBug(b._id)}
						onmouseleave={leave}
						onfocus={() => enterBug(b._id)}
						onblur={leave}
						class="sonar-row w-full px-2 py-1.5 rounded text-sm flex justify-between items-start gap-2 text-left"
						title="Open this bug's cluster"
					>
						<div class="min-w-0 flex-1">
							<div class="truncate sonar-text">{b.title}</div>
							<div class="text-xs sonar-muted truncate">
								{displayReporter(b.reporter)} · {formatDate(b.createdAt)}{b.source === 'slack' ? ' · slack' : ''}{b.source === 'public' ? ' · public' : ''}
							</div>
						</div>
						<span
							class="text-xs px-2 py-0.5 rounded-full border whitespace-nowrap"
							style="color: {sevColors[b.severity].fg}; background: {sevColors[b.severity].bg}; border-color: {sevColors[b.severity].fg}66;"
						>{b.severity}</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
