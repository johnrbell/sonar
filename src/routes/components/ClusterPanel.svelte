<script lang="ts">
	import type { Bug, Cluster, Stage } from '$lib/schemas';
	import { FEATURE_AREAS } from '$lib/constants';
	import { defaultStageFor, STAGE_LABELS } from '$lib/stages';
	import ClusterOverview from './ClusterOverview.svelte';

	// drillPath: breadcrumb stack (empty at top). onDrillJump/Reset = jump
	// to a depth / reset to top. onHover syncs to left-side bubble viz.
	// onOpenBug = click a "Recently filed" row to surface that bug. focusBugId
	// drives scroll+flash on that bug card. mode='archive' renders the
	// synthetic archive cluster (no Asana, Unarchive button, etc).
	type Props = {
		cluster: Cluster | null;
		bugs: Bug[];
		sortedClusters: Cluster[];
		hotIds: Set<string>;
		drillPath?: Cluster[];
		onMutated: () => void;
		onSelectCluster: (id: string) => void;
		onDrillJump?: (depth: number) => void;
		onDrillReset?: () => void;
		onHover?: (kind: 'cluster' | 'area' | 'bug' | null, value?: string) => void;
		onOpenBug?: (bugId: string) => void;
		focusBugId?: string | null;
		mode?: 'cluster' | 'archive';
		onArchive?: (bugId: string) => Promise<void> | void;
		onUnarchive?: (bugId: string) => Promise<void> | void;
	};
	let {
		cluster,
		bugs,
		sortedClusters,
		hotIds,
		drillPath = [],
		onMutated,
		onSelectCluster,
		onDrillJump,
		onDrillReset,
		onHover,
		onOpenBug,
		focusBugId = null,
		mode = 'cluster',
		onArchive,
		onUnarchive
	}: Props = $props();
	const isArchive = $derived(mode === 'archive');
	let busyArchiveId = $state<string | null>(null);
	let busyUnarchiveId = $state<string | null>(null);

	async function archive(bugId: string) {
		if (!onArchive) return;
		busyArchiveId = bugId;
		try { await onArchive(bugId); } finally { busyArchiveId = null; }
	}

	function onBugDragStart(e: DragEvent, bugId: string) {
		if (!e.dataTransfer) return;
		e.dataTransfer.setData('text/x-sonar-bug-id', bugId);
		e.dataTransfer.effectAllowed = 'move';
		// .sonar-root[data-dragging-bug] keys CSS that dims the radar + lifts
		// the Archive pool. Cleared on dragend (fires after drop or cancel).
		document.querySelector('.sonar-root')?.setAttribute('data-dragging-bug', 'true');
	}
	function onBugDragEnd() {
		document.querySelector('.sonar-root')?.removeAttribute('data-dragging-bug');
	}
	async function unarchive(bugId: string) {
		if (!onUnarchive) return;
		busyUnarchiveId = bugId;
		try { await onUnarchive(bugId); } finally { busyUnarchiveId = null; }
	}

	// Scroll + flash the focused bug. rAF lets the panel mount first.
	$effect(() => {
		const id = focusBugId;
		if (!id) return;
		requestAnimationFrame(() => {
			const el = document.getElementById(`sonar-bug-card-${id}`);
			if (!el) return;
			el.scrollIntoView({ behavior: 'smooth', block: 'center' });
			el.classList.add('sonar-bug-flash');
			setTimeout(() => el.classList.remove('sonar-bug-flash'), 1600);
		});
	});

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

	// Intake-type chip + per-type meta field labels (mirror followupFieldKeys()
	// on the Slack side). Iteration order is the display order.
	const intakeChip = {
		feature: { label: 'Feature', fg: '#6366f1', bg: 'rgba(99, 102, 241, 0.10)' },
		question: { label: 'Question', fg: '#0891b2', bg: 'rgba(8, 145, 178, 0.10)' },
		bug: { label: 'Bug', fg: '#64748b', bg: 'rgba(100, 116, 139, 0.10)' }
	} as const;

	// Stage chip colors — same vocabulary as the resolver stepper, but
	// rendered as small inline chips so the cluster panel can show where
	// each ticket sits in the resolver workflow at a glance. Tuned for
	// both light and dark themes (low-saturation foregrounds + 10% alpha
	// backgrounds read fine on either).
	const stageChip: Record<Stage, { label: string; fg: string; bg: string }> = {
		triage: { label: STAGE_LABELS.triage, fg: '#64748b', bg: 'rgba(100, 116, 139, 0.10)' },
		'pm-review': { label: STAGE_LABELS['pm-review'], fg: '#d97706', bg: 'rgba(217, 119, 6, 0.10)' },
		'ready-for-eng': { label: STAGE_LABELS['ready-for-eng'], fg: '#4a1ee3', bg: 'rgba(74, 30, 227, 0.10)' },
		'in-flight': { label: STAGE_LABELS['in-flight'], fg: '#0ea5e9', bg: 'rgba(14, 165, 233, 0.10)' },
		done: { label: STAGE_LABELS.done, fg: '#059669', bg: 'rgba(5, 150, 105, 0.10)' }
	};
	const META_FIELDS_BY_TYPE: Record<'bug' | 'feature' | 'question', Array<[string, string]>> = {
		bug: [
			['device', 'Device / OS'],
			['browser', 'Browser'],
			['url', 'URL'],
			['repro', 'Repro steps'],
			['expectedActual', 'Expected vs. actual'],
			['screenshotUrl', 'Screenshot']
		],
		feature: [
			['userPain', 'User pain'],
			['proposedApproach', 'Proposed approach'],
			['urgency', 'Urgency']
		],
		question: [
			['audience', 'Audience'],
			['context', 'Context']
		]
	};

	function metaPairsFor(b: Bug): Array<[string, string]> {
		const type = b.intakeType ?? 'bug';
		const fields = META_FIELDS_BY_TYPE[type];
		const out: Array<[string, string]> = [];
		const meta = (b.meta ?? {}) as Record<string, unknown>;
		for (const [key, label] of fields) {
			const v = meta[key];
			if (typeof v === 'string' && v.trim().length > 0) out.push([label, v.trim()]);
		}
		return out;
	}

	const clusterBugs = $derived(
		cluster ? cluster.bugIds.map((id) => bugs.find((b) => b._id === id)).filter(Boolean) as Bug[] : []
	);

	// Dominant suggested owner: surfaces a name when >= 50% of the cluster's
	// bugs name them as assignee. At-a-glance "who picks this up".
	const dominantAssignee = $derived.by(() => {
		if (clusterBugs.length === 0) return null;
		const counts: Record<string, number> = {};
		for (const b of clusterBugs) {
			if (!b.assignee) continue;
			counts[b.assignee] = (counts[b.assignee] || 0) + 1;
		}
		const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
		if (!top) return null;
		const [name, n] = top;
		if (n / clusterBugs.length < 0.5) return null;
		return { name, count: n, total: clusterBugs.length };
	});

	const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

	// Gracefully render raw Slack user/channel ids when the bot couldn't
	// resolve them (missing scope, Enterprise-Grid edge case, etc).
	const SLACK_USER_ID_RE = /^U[A-Z0-9]{6,}$/;
	const SLACK_CHANNEL_ID_RE = /^[CG][A-Z0-9]{6,}$/;
	const displayReporter = (raw: string | undefined): string => {
		if (!raw) return 'Anonymous';
		if (SLACK_USER_ID_RE.test(raw)) return 'Slack user';
		return raw;
	};
	const displayChannel = (raw: string): string => {
		const stripped = raw.replace(/^#/, '');
		if (SLACK_CHANNEL_ID_RE.test(stripped)) return 'thread';
		return stripped;
	};
	// Fallback link for thread chips lacking a real permalink (seed +
	// CSV imports). app_redirect opens the channel in the user's workspace.
	const slackChannelUrl = (raw: string): string => {
		const stripped = raw.replace(/^#/, '');
		return `https://slack.com/app_redirect?channel=${encodeURIComponent(stripped)}`;
	};

	let busyBugId = $state<string | null>(null);
	let busyAll = $state(false);
	let deletingBugId = $state<string | null>(null);
	let errorMsg = $state<string | null>(null);

	// Destructive delete — archive-view only. Server also enforces
	// ?confirm=true so a stray fetch can't wipe data either.
	async function deleteBug(bug: Bug) {
		const ok = window.confirm(
			`Permanently delete this archived bug?\n\n"${bug.title}"\n\nThis cannot be undone. Slack threads and Asana placeholders attached to it go with it.\n\nTo just hide it from active clusters, click Unarchive instead.`
		);
		if (!ok) return;
		deletingBugId = bug._id;
		errorMsg = null;
		try {
			const r = await fetch(`/api/bugs/${encodeURIComponent(bug._id)}?confirm=true`, {
				method: 'DELETE'
			});
			const data = await r.json().catch(() => ({}));
			if (!r.ok) {
				errorMsg = data.error || `Failed to delete (${r.status})`;
				return;
			}
			onMutated();
		} finally {
			deletingBugId = null;
		}
	}

	async function createAsanaTask(bugId: string) {
		busyBugId = bugId;
		errorMsg = null;
		try {
			const r = await fetch('/api/asana', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ bugId, confirm: true })
			});
			const data = await r.json().catch(() => ({}));
			if (!r.ok) {
				errorMsg = data.error || `Failed (${r.status})`;
				return;
			}
			onMutated();
		} finally {
			busyBugId = null;
		}
	}

	async function createAsanaTasksForCluster() {
		if (!cluster) return;
		busyAll = true;
		errorMsg = null;
		try {
			// One placeholder per bug — discoverable, matches the asana-tasks skill contract.
			for (const id of cluster.bugIds) {
				const r = await fetch('/api/asana', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ bugId: id, confirm: true })
				});
				if (!r.ok) {
					const data = await r.json().catch(() => ({}));
					errorMsg = data.error || `One bug failed (${r.status})`;
					break;
				}
			}
			onMutated();
		} finally {
			busyAll = false;
		}
	}
</script>

<!-- Drill breadcrumb: mirrors the breadcrumb above the radar. -->
{#if drillPath.length > 0}
	<div class="text-xs sonar-muted mb-3 flex items-center gap-1 flex-wrap">
		<button onclick={() => onDrillReset?.()} class="hover:underline" style="color: var(--sonar-accent);">Top</button>
		{#each drillPath as p, i (i + ':' + p.id)}
			<span aria-hidden="true">›</span>
			{#if i < drillPath.length - 1}
				<button onclick={() => onDrillJump?.(i + 1)} class="hover:underline" style="color: var(--sonar-accent);">{p.label}</button>
			{:else}
				<span class="sonar-text">{p.label}</span>
			{/if}
		{/each}
	</div>
{/if}

{#if !cluster}
	<ClusterOverview {bugs} {sortedClusters} {hotIds} {onSelectCluster} {onHover} {onOpenBug} />
{:else}
	<div class="flex flex-col gap-3 overflow-y-auto">
		<div>
			<div class="text-xs sonar-muted uppercase tracking-wider">
				{isArchive ? `Archive · ${cluster.bugIds.length} bug${cluster.bugIds.length > 1 ? 's' : ''}` : `Cluster · ${cluster.bugIds.length} bug${cluster.bugIds.length > 1 ? 's' : ''}`}
			</div>
			<div class="text-base font-medium mt-1 sonar-text">{cluster.label}</div>
			{#if isArchive}
				<div class="text-xs sonar-muted mt-1">Bugs set aside. They don't appear in the active clusters and aren't counted in stats. Click Unarchive on any card to bring it back.</div>
			{:else}
				<div class="flex flex-wrap gap-1 mt-2">
					{#each cluster.areas as a (a)}
						<span class="text-xs px-2 py-0.5 rounded-full border" style="color: {colorFor(a)}; border-color: {colorFor(a)};">{a}</span>
					{/each}
				</div>
				{#if dominantAssignee}
					<div class="mt-2 text-xs"
						title="Owner suggested on {dominantAssignee.count} of {dominantAssignee.total} bugs in this cluster"
					>
						<span class="sonar-muted">Likely owner</span>
						<span class="ml-1 px-2 py-0.5 rounded inline-block"
							style="color: var(--sonar-brand-fg); border: 1px solid var(--sonar-brand-border); background: var(--sonar-brand-bg);"
						>→ {dominantAssignee.name}</span>
					</div>
				{/if}
				<button
					type="button"
					onclick={createAsanaTasksForCluster}
					disabled={busyAll || cluster.bugIds.length === 0}
					class="mt-3 w-full px-3 py-2 text-sm rounded text-white disabled:opacity-60"
					style="background: #4a1ee3;"
					title="Stamps a placeholder Asana gid + URL on every bug in this cluster. Self-contained — there is no live Asana integration in this build."
				>
					{busyAll ? 'Stamping…' : `+ Create Asana tasks for cluster (${cluster.bugIds.length} placeholder${cluster.bugIds.length === 1 ? '' : 's'})`}
				</button>
			{/if}
			{#if errorMsg}
				<div class="mt-2 text-xs text-red-600 dark:text-red-300">{errorMsg}</div>
			{/if}
		</div>

		<div class="text-xs uppercase tracking-wider sonar-muted mt-2">{isArchive ? 'Archived bugs' : 'Bugs in this cluster'}</div>
		<div class="flex flex-col gap-2">
			{#each clusterBugs as b (b._id)}
				{@const it = (b.intakeType ?? 'bug') as 'bug' | 'feature' | 'question'}
				{@const metaPairs = metaPairsFor(b)}
				{@const bugStage = defaultStageFor(b)}
				<div
					id="sonar-bug-card-{b._id}"
					class="sonar-card sonar-bug-card rounded-lg p-3"
					class:opacity-50={deletingBugId === b._id}
					class:sonar-bug-card-draggable={!isArchive}
					role={!isArchive ? 'listitem' : undefined}
					aria-label={!isArchive ? `${b.title}. Drag onto Archive pool to archive.` : undefined}
					draggable={!isArchive}
					ondragstart={(e) => !isArchive && onBugDragStart(e, b._id)}
					ondragend={onBugDragEnd}
					onmouseenter={() => onHover?.('bug', b._id)}
					onmouseleave={() => onHover?.(null)}
				>
					<div class="flex justify-between items-start gap-2">
						<div class="font-medium text-sm sonar-text flex-1">{b.title}</div>
						<span
							class="text-xs px-2 py-0.5 rounded-full border whitespace-nowrap"
							style="color: {intakeChip[it].fg}; background: {intakeChip[it].bg}; border-color: {intakeChip[it].fg}66;"
							title="Intake type — set by the classifier when the ticket was filed."
						>{intakeChip[it].label}</span>
						<span
							class="text-xs px-2 py-0.5 rounded-full border whitespace-nowrap"
							style="color: {sevColors[b.severity].fg}; background: {sevColors[b.severity].bg}; border-color: {sevColors[b.severity].fg}66;"
							title={b.severitySetBy ? `Severity set by ${b.severitySetBy} via Slack` : 'Auto-classified severity'}
						>{b.severity}{b.severitySetBy ? ' ✓' : ''}</span>
						{#if !isArchive && bugStage}
							<a
								href="/resolver/{b._id}"
								class="text-xs px-2 py-0.5 rounded-full border whitespace-nowrap hover:opacity-90"
								style="color: {stageChip[bugStage].fg}; background: {stageChip[bugStage].bg}; border-color: {stageChip[bugStage].fg}66;"
								title="Resolver stage — click to open this ticket's workflow page"
								onclick={(e) => e.stopPropagation()}
							>{stageChip[bugStage].label}</a>
						{/if}
						{#if isArchive}
							<button
								type="button"
								onclick={() => unarchive(b._id)}
								disabled={busyUnarchiveId === b._id}
								class="px-2 py-1 text-xs rounded inline-flex items-center gap-1 disabled:opacity-60 hover:opacity-90 whitespace-nowrap"
								style="color: var(--sonar-brand-fg); border: 1px solid var(--sonar-brand-border); background: var(--sonar-brand-bg);"
								title="Restore this bug to the active clusters"
								aria-label="Unarchive bug"
							>
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 7 3 3 7 3"/><path d="M3 3l7 7"/><path d="M21 12a9 9 0 1 1-3-6.7"/></svg>
								{busyUnarchiveId === b._id ? 'Unarchiving…' : 'Unarchive'}
							</button>
						{:else}
							<button
								type="button"
								onclick={() => archive(b._id)}
								disabled={busyArchiveId === b._id}
								class="sonar-muted hover:text-amber-600 disabled:opacity-40 transition p-0.5 leading-none"
								title="Archive this bug (sets it aside; click Archived pool to restore)"
								aria-label="Archive bug"
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
							</button>
						{/if}
					</div>
					<div class="text-xs sonar-muted mt-1 mb-2">{b.description}</div>
					{#if b.areas && b.areas.length > 0}
						<div class="flex flex-wrap gap-1 mb-2">
							{#each b.areas as a (a)}
								<span
									class="text-[10px] px-1.5 py-0.5 rounded-full border inline-block"
									style="color: {colorFor(a)}; border-color: {colorFor(a)}66; background: {colorFor(a)}14;"
									title="Auto-classified feature area"
								>{a}</span>
							{/each}
						</div>
					{/if}
					{#if metaPairs.length > 0}
						<div
							class="mb-2 rounded border px-2 py-1.5 text-xs"
							style="border-color: var(--sonar-border); background: var(--sonar-panel);"
							title="Details added via the Slack follow-up modal"
						>
							{#each metaPairs as [label, value] (label)}
								<div class="mb-0.5 last:mb-0">
									<span class="sonar-muted mr-1">{label}:</span>
									{#if label === 'Screenshot' && /^https?:\/\//.test(value)}
										<a href={value} target="_blank" rel="noopener noreferrer" class="inline-block mt-1 align-top" title="Open screenshot in new tab">
											<img
												src={value}
												alt="Bug screenshot"
												loading="lazy"
												class="max-h-48 max-w-full rounded border"
												style="border-color: var(--sonar-border); background: var(--sonar-bg);"
											/>
										</a>
									{:else if /^https?:\/\//.test(value)}
										<a href={value} target="_blank" rel="noopener noreferrer" class="hover:underline" style="color: var(--sonar-accent);">{value}</a>
									{:else}
										<span class="sonar-text whitespace-pre-wrap">{value}</span>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
					{#if b.severitySetBy}
						<div class="text-xs sonar-muted mb-2 italic" title={b.severitySetAt}>
							severity set by {b.severitySetBy}
						</div>
					{/if}

					{#if b.assignee || (b.responders && b.responders.length > 0)}
						<div class="flex flex-wrap items-center gap-1 mb-2 text-xs">
							{#if b.assignee}
								<span class="px-2 py-0.5 rounded border inline-flex items-center gap-1"
									style="color: var(--sonar-brand-fg); border-color: var(--sonar-brand-border); background: var(--sonar-brand-bg);"
									title="Suggested triage owner"
								>→ {b.assignee}</span>
							{/if}
							{#if b.responders && b.responders.length > 0}
								<span class="sonar-muted">· tagged {b.responders.join(', ')}</span>
							{/if}
						</div>
					{/if}

					{#if b.slackThreads && b.slackThreads.length > 0}
						<div class="flex flex-wrap gap-1 mb-2">
							{#each b.slackThreads as t, i (t.ts + i)}
								{@const channelLabel = displayChannel(t.channel)}
								{@const reporterLabel = displayReporter(t.reporter)}
								{@const href = t.permalink ?? slackChannelUrl(t.channel)}
								{@const hoverText = t.permalink
									? `Open Slack thread in ${t.channel}${t.reporter ? ' · ' + t.reporter : ''}`
									: `Open #${t.channel.replace(/^#/, '')} in Slack`}
								<a
									{href}
									target="_blank"
									rel="noopener noreferrer"
									class="text-xs px-2 py-0.5 rounded border inline-flex items-center gap-1 hover:opacity-80"
									style="color: var(--sonar-slack-fg); border-color: var(--sonar-slack-border); background: var(--sonar-slack-bg);"
									title={hoverText}
								>
									<span style="font-weight: 700; letter-spacing: 0.02em;">#</span>
									<span>{channelLabel}</span>
									{#if t.reporter}<span class="opacity-70">· {reporterLabel}</span>{/if}
								</a>
							{/each}
						</div>
					{/if}

					{#if b.attachments && b.attachments.length > 0}
						<div class="flex flex-wrap gap-1 mb-2">
							{#each b.attachments as att, i (att.id + i)}
								{@const fhref = att.urlPrivate
									? `/api/slack/file?url=${encodeURIComponent(att.urlPrivate)}`
									: (att.permalink ?? '#')}
								<a
									href={fhref}
									target="_blank"
									rel="noopener noreferrer"
									class="text-xs px-2 py-0.5 rounded border inline-flex items-center gap-1 hover:opacity-80"
									style="color: var(--sonar-slack-fg); border-color: var(--sonar-slack-border); background: var(--sonar-slack-bg);"
									title={att.name ?? 'Slack attachment'}
								>
									<span style="font-weight: 700;">{att.isImage ? 'IMG' : 'FILE'}</span>
									<span class="opacity-80">{att.name ?? 'attachment'}</span>
								</a>
							{/each}
						</div>
					{/if}

					<div class="flex justify-between items-center text-xs sonar-muted gap-2 flex-wrap">
						<span title={SLACK_USER_ID_RE.test(b.reporter) ? `Raw Slack id: ${b.reporter}` : undefined}>{displayReporter(b.reporter)} · {formatDate(b.createdAt)}{b.source === 'public' ? ' · public' : ''}{b.source === 'slack' ? ' · slack' : ''}</span>
						<div class="flex items-center gap-1.5">
						{#if !isArchive && bugStage}
							<a
								href="/resolver/{b._id}"
								class="px-2 py-1 text-xs rounded inline-flex items-center gap-1 hover:opacity-80"
								style="color: var(--sonar-brand-fg); border: 1px solid var(--sonar-brand-border); background: var(--sonar-brand-bg);"
								title="Open the resolver workflow page for this ticket"
								onclick={(e) => e.stopPropagation()}
							>
								Open in Resolver →
							</a>
						{/if}
						{#if isArchive}
							<button
								type="button"
								onclick={() => deleteBug(b)}
								disabled={deletingBugId === b._id}
								class="px-2 py-1 text-xs rounded inline-flex items-center gap-1 text-red-600 hover:bg-red-600 hover:text-white disabled:opacity-60 transition"
								style="border: 1px solid currentColor;"
								title="Permanently delete this archived bug. Requires confirmation."
							>
								<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
								{deletingBugId === b._id ? 'Deleting…' : 'Delete forever'}
							</button>
						{:else if b.asanaTaskUrl}
							<a
								href={b.asanaTaskUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="px-2 py-1 text-xs rounded inline-flex items-center gap-1 hover:opacity-80"
								style="color: var(--sonar-asana-fg); border: 1px solid var(--sonar-asana-border); background: var(--sonar-asana-bg);"
								title={b.asanaPlaceholder ? 'Placeholder gid — wires to a real Asana task when the asana-tasks skill is connected.' : 'Open in Asana'}
							>
								Asana ↗{b.asanaPlaceholder ? ' (placeholder)' : ''}
							</a>
						{:else}
							<button
								type="button"
								onclick={() => createAsanaTask(b._id)}
								disabled={busyBugId === b._id}
								class="px-2 py-1 text-xs rounded disabled:opacity-60 hover:opacity-80"
								style="color: var(--sonar-brand-fg); border: 1px solid var(--sonar-brand-border); background: var(--sonar-brand-bg);"
								title="Stamps a placeholder Asana gid + URL on this bug."
							>{busyBugId === b._id ? 'Stamping…' : '+ Asana'}</button>
						{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	:global(.sonar-root .sonar-card) {
		background: var(--sonar-panel-2);
		border: 1px solid var(--sonar-border);
	}
</style>
