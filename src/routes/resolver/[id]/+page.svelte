<script lang="ts">
	/**
	 * Ticket Resolver page.
	 *
	 * Per-ticket workflow surface: assign engineering owner + reviewer
	 * (gates triage -> pm-review), draft the spec (gates pm-review ->
	 * ready-for-eng, which also stamps a placeholder task), then advance the
	 * ticket through in-flight and finally done (which stamps the task closed).
	 * All side effects are self-contained — no live Slack/Asana calls.
	 *
	 * Imports `canTransition` from $lib/stages so the
	 * disabled-state on the Advance button matches the server's gate
	 * predicate exactly — same source of truth either side of the wire.
	 */
	import { onMount } from 'svelte';
	import type { Bug, Stage } from '$lib/schemas';
	import {
		canTransition,
		defaultStageFor,
		nextForwardStage,
		previousStage,
		STAGE_LABELS
	} from '$lib/stages';
	import { buildAsanaTaskDescription } from '$lib/asana-stamp';
	import '$lib/styles/sonar.css';
	import { restoreLocalPrefs } from '../../components/page-prefs';
	import StageStepper from './StageStepper.svelte';
	import StageHistoryLog from './StageHistoryLog.svelte';

	type Props = { data: { bugId: string } };
	let { data }: Props = $props();

	// The theme tokens (--sonar-*) are only defined under
	// `.sonar-root[data-theme='light'|'dark']`. Without this attribute NONE
	// of the color variables resolve, so e.g. the Advance button (styled
	// `background: var(--sonar-accent)` + white text) renders white-on-white
	// and disappears. Mirror the main page: default light, restore the saved
	// preference on mount, and persist toggles under the same localStorage key.
	let theme = $state<'light' | 'dark'>('light');

	let bug = $state<Bug | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let actionError = $state<string | null>(null);
	let actionStatus = $state<string | null>(null);
	let busy = $state(false);

	// PM-edit local buffers. Patched independently of stage advancement
	// (PATCH /bugs/[id]) so the PM can save spec drafts mid-edit without
	// having to advance the stage.
	let assigneeDraft = $state('');
	let reviewerDraft = $state('');
	let specDraft = $state('');
	let backtrackNote = $state('');
	let showBacktrackInput = $state(false);

	async function loadBug() {
		loading = true;
		loadError = null;
		try {
			const r = await fetch(`/api/bugs/${encodeURIComponent(data.bugId)}`);
			const body = await r.json().catch(() => ({}));
			if (!r.ok) {
				loadError = body.error || `Failed to load (${r.status})`;
				return;
			}
			const b = body.bug as Bug;
			// Resolver doesn't apply to questions; show a friendly 404-like state.
			if (b.intakeType === 'question') {
				loadError = 'Questions do not enter the resolver workflow. Return to Sonar to view this ticket.';
				return;
			}
			bug = b;
			assigneeDraft = b.assignee ?? '';
			reviewerDraft = b.reviewer ?? '';
			specDraft = b.specMarkdown ?? '';
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		const prefs = restoreLocalPrefs();
		if (prefs.theme) theme = prefs.theme;
		loadBug();
	});

	function toggleTheme() {
		theme = theme === 'light' ? 'dark' : 'light';
		try {
			localStorage.setItem('sonar.theme', theme);
		} catch (e) {
			console.warn('[sonar] localStorage unavailable', e);
		}
	}

	// Pessimistic view of the in-flight bug used for canTransition checks:
	// the live `bug` doc reflects the LAST server response, but the user
	// may have typed into specDraft / reviewer / assignee since. We feed
	// canTransition the bug-with-drafts-applied so the [Advance] button
	// flips green the instant the gate's actually satisfied (even if the
	// user hasn't hit Save Draft yet).
	const bugWithDrafts = $derived<Bug | null>(
		bug
			? {
					...bug,
					assignee: assigneeDraft.trim() || undefined,
					reviewer: reviewerDraft.trim() || undefined,
					specMarkdown: specDraft || undefined
				}
			: null
	);

	const currentStage = $derived<Stage | null>(bugWithDrafts ? defaultStageFor(bugWithDrafts) : null);
	const forwardTarget = $derived<Stage | null>(currentStage ? nextForwardStage(currentStage) : null);
	const backwardTarget = $derived<Stage | null>(currentStage ? previousStage(currentStage) : null);

	const advanceCheck = $derived(
		bugWithDrafts && currentStage && forwardTarget
			? canTransition(bugWithDrafts, currentStage, forwardTarget)
			: { ok: false as const, reason: 'Loading…' }
	);

	const tooltipFor = (s: Stage): string => {
		const HINTS: Record<Stage, string> = {
			triage: 'Filed — needs an engineering owner and a PM reviewer.',
			'pm-review': 'PM is drafting the spec.',
			'ready-for-eng': 'Spec is signed off — Asana task exists, engineering can pick up.',
			'in-flight': 'Engineering is working on it.',
			done: 'Resolved — Asana closed, Slack followup posted.'
		};
		return HINTS[s];
	};

	const hasDraftChanges = $derived(
		bug !== null &&
			((assigneeDraft.trim() || '') !== (bug.assignee ?? '') ||
				(reviewerDraft.trim() || '') !== (bug.reviewer ?? '') ||
				specDraft !== (bug.specMarkdown ?? ''))
	);

	// No identity provider in this build — actions are attributed to a generic PM.
	const actorName = 'PM';

	async function saveDraft() {
		if (!bug || !hasDraftChanges) return;
		busy = true;
		actionError = null;
		actionStatus = null;
		try {
			const patch: Record<string, unknown> = {};
			if (assigneeDraft.trim() !== (bug.assignee ?? '')) patch.assignee = assigneeDraft.trim();
			if (reviewerDraft.trim() !== (bug.reviewer ?? '')) patch.reviewer = reviewerDraft.trim();
			if (specDraft !== (bug.specMarkdown ?? '')) patch.specMarkdown = specDraft;
			patch.setBy = actorName;
			const r = await fetch(`/api/bugs/${encodeURIComponent(bug._id)}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(patch)
			});
			const body = await r.json().catch(() => ({}));
			if (!r.ok) {
				actionError = body.error || `Save failed (${r.status})`;
				return;
			}
			bug = body.bug as Bug;
			assigneeDraft = bug.assignee ?? '';
			reviewerDraft = bug.reviewer ?? '';
			specDraft = bug.specMarkdown ?? '';
			actionStatus = 'Draft saved.';
		} finally {
			busy = false;
		}
	}

	async function advanceTo(target: Stage, note?: string) {
		if (!bug) return;
		// If there are unsaved drafts, save them first so the server-side
		// gate check has the same view canTransition() just OK'd here.
		if (hasDraftChanges) {
			await saveDraft();
			if (actionError) return;
		}
		busy = true;
		actionError = null;
		actionStatus = null;
		try {
			const r = await fetch(`/api/bugs/${encodeURIComponent(bug._id)}/advance`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ to: target, by: actorName, ...(note ? { note } : {}) })
			});
			const body = await r.json().catch(() => ({}));
			if (!r.ok) {
				actionError = body.error || `Advance failed (${r.status})`;
				return;
			}
			bug = body.bug as Bug;
			assigneeDraft = bug.assignee ?? '';
			reviewerDraft = bug.reviewer ?? '';
			specDraft = bug.specMarkdown ?? '';
			actionStatus = summarizeSideEffects(target, body.sideEffects);
			showBacktrackInput = false;
			backtrackNote = '';
		} finally {
			busy = false;
		}
	}

	function summarizeSideEffects(target: Stage, fx: Record<string, unknown> | undefined): string {
		const base = `Moved to ${STAGE_LABELS[target]}.`;
		if (!fx) return base;
		const bits: string[] = [];
		const asana = fx.asanaCreated as { url?: string; reused?: boolean; error?: string } | undefined;
		if (asana?.error) bits.push(`Asana stamp failed (${asana.error})`);
		else if (asana?.reused) bits.push('Asana task reused.');
		else if (asana?.url) bits.push('Asana placeholder created.');
		const slack = fx.slackFollowup as {
			threadsPosted?: number;
			threadsAttempted?: number;
			skipped?: string;
			error?: string;
		} | undefined;
		if (slack?.skipped) bits.push('Slack followup skipped (already resolved).');
		else if (slack?.error) bits.push(`Slack followup failed (${slack.error})`);
		else if (typeof slack?.threadsAttempted === 'number')
			bits.push(`Slack followup posted to ${slack.threadsPosted ?? 0}/${slack.threadsAttempted} thread(s).`);
		return bits.length > 0 ? `${base} ${bits.join(' ')}` : base;
	}

	const taskPreview = $derived(bugWithDrafts ? buildAsanaTaskDescription(bugWithDrafts) : '');
</script>

<svelte:head>
	<title>Sonar resolver · {bug?.title ?? data.bugId}</title>
</svelte:head>

<div class="sonar-root" data-theme={theme} style="overflow-y: auto;">
	<header class="sonar-header">
		<div class="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
			<div class="flex items-center gap-3">
				<a href="/" class="text-white/70 hover:text-white inline-flex items-center gap-1.5">
					<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
					<span class="text-xs">Back to Sonar</span>
				</a>
				<span class="h-5 w-px bg-white/25" aria-hidden="true"></span>
				<div class="text-white font-medium">Ticket Resolver</div>
				<span class="text-xs text-white/60 font-mono">{data.bugId}</span>
			</div>
			<button
				type="button"
				onclick={toggleTheme}
				aria-label="Toggle light/dark theme"
				class="text-xs text-white/85 hover:text-white transition px-2.5 py-1 rounded border border-white/25 hover:bg-white/10"
			>
				{theme === 'light' ? 'Dark mode' : 'Light mode'}
			</button>
		</div>
	</header>

	<main class="max-w-5xl w-full mx-auto px-6 py-6 flex flex-col gap-6">
		{#if loading}
			<div class="flex items-center justify-center p-12">
				<div class="animate-spin h-6 w-6 border-2 rounded-full" style="border-color: var(--sonar-border); border-top-color: var(--sonar-accent);"></div>
			</div>
		{:else if loadError}
			<div class="rounded-lg border p-6" style="border-color: var(--sonar-border); background: var(--sonar-panel);">
				<div class="text-base font-medium mb-1" style="color: var(--sonar-text);">Can't load this ticket</div>
				<div class="text-sm mb-3" style="color: var(--sonar-text-muted);">{loadError}</div>
				<a href="/" class="text-sm hover:underline" style="color: var(--sonar-accent);">← Back to Sonar</a>
			</div>
		{:else if bug && currentStage}
			<!-- Title + chips -->
			<section class="rounded-lg border p-5" style="border-color: var(--sonar-border); background: var(--sonar-panel);">
				<div class="flex items-start gap-3 mb-2">
					<h1 class="text-xl font-medium flex-1" style="color: var(--sonar-text);">{bug.title}</h1>
					<span
						class="text-xs px-2 py-0.5 rounded-full border whitespace-nowrap"
						style="color: var(--sonar-text); border-color: var(--sonar-border);"
					>{bug.intakeType ?? 'bug'}</span>
					<span
						class="text-xs px-2 py-0.5 rounded-full border whitespace-nowrap"
						style="color: var(--sonar-text); border-color: var(--sonar-border);"
					>{bug.severity}</span>
				</div>
				<div class="text-sm whitespace-pre-wrap mb-3" style="color: var(--sonar-text-muted);">{bug.description}</div>
				<div class="text-xs" style="color: var(--sonar-text-muted);">
					Filed by {bug.reporter} · {new Date(bug.createdAt).toLocaleDateString()}
					{#if bug.areas.length > 0}
						· {bug.areas.join(', ')}
					{/if}
				</div>
				{#if bug.slackThreads && bug.slackThreads.length > 0}
					<div class="flex flex-wrap gap-1 mt-2">
						{#each bug.slackThreads as t, i (t.ts + i)}
							<a
								href={t.permalink ?? `https://slack.com/app_redirect?channel=${encodeURIComponent(t.channel.replace(/^#/, ''))}`}
								target="_blank"
								rel="noopener noreferrer"
								class="text-xs px-2 py-0.5 rounded border inline-flex items-center gap-1 hover:opacity-80"
								style="color: var(--sonar-slack-fg); border-color: var(--sonar-slack-border); background: var(--sonar-slack-bg);"
							>
								<span style="font-weight: 700;">#</span>
								<span>{t.channel.replace(/^#/, '')}</span>
								{#if t.reporter}<span class="opacity-70">· {t.reporter}</span>{/if}
							</a>
						{/each}
					</div>
				{/if}
				{#if bug.asanaTaskUrl}
					<div class="mt-2">
						<a
							href={bug.asanaTaskUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="text-xs px-2 py-0.5 rounded inline-flex items-center gap-1 hover:opacity-80"
							style="color: var(--sonar-asana-fg); border: 1px solid var(--sonar-asana-border); background: var(--sonar-asana-bg);"
							title={bug.asanaPlaceholder ? 'Placeholder gid — wires to a real Asana task when asana-tasks is connected.' : 'Open in Asana'}
						>
							Asana ↗{bug.asanaPlaceholder ? ' (placeholder)' : ''}
							{#if bug.asanaClosedAt}· closed{/if}
						</a>
					</div>
				{/if}
			</section>

			<!-- Stepper -->
			<section class="rounded-lg border p-5" style="border-color: var(--sonar-border); background: var(--sonar-panel);">
				<div class="text-xs uppercase tracking-wider mb-3" style="color: var(--sonar-text-muted);">Workflow</div>
				<StageStepper current={currentStage} {tooltipFor} />
			</section>

			<!-- Editors -->
			<section class="rounded-lg border p-5 flex flex-col gap-4" style="border-color: var(--sonar-border); background: var(--sonar-panel);">
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					<label class="flex flex-col gap-1">
						<span class="text-xs uppercase tracking-wider" style="color: var(--sonar-text-muted);">Engineering owner</span>
						<input
							type="text"
							bind:value={assigneeDraft}
							placeholder="e.g. Roi Lipman"
							class="rounded border px-3 py-2 text-sm"
							style="border-color: var(--sonar-border); background: var(--sonar-panel-2); color: var(--sonar-text);"
						/>
					</label>
					<label class="flex flex-col gap-1">
						<span class="text-xs uppercase tracking-wider" style="color: var(--sonar-text-muted);">PM / reviewer</span>
						<input
							type="text"
							bind:value={reviewerDraft}
							placeholder="e.g. Noam Mendel"
							class="rounded border px-3 py-2 text-sm"
							style="border-color: var(--sonar-border); background: var(--sonar-panel-2); color: var(--sonar-text);"
						/>
					</label>
				</div>
				<label class="flex flex-col gap-1">
					<span class="text-xs uppercase tracking-wider" style="color: var(--sonar-text-muted);">Spec (markdown)</span>
					<textarea
						bind:value={specDraft}
						rows="10"
						placeholder="Required before advancing to ready-for-eng. Plain markdown; becomes the Asana task description when the stage advances."
						class="rounded border px-3 py-2 text-sm font-mono"
						style="border-color: var(--sonar-border); background: var(--sonar-panel-2); color: var(--sonar-text); resize: vertical;"
					></textarea>
				</label>
				<div class="flex items-center justify-between flex-wrap gap-2">
					<button
						type="button"
						onclick={saveDraft}
						disabled={busy || !hasDraftChanges}
						class="px-3 py-1.5 text-sm rounded disabled:opacity-50"
						style="color: var(--sonar-brand-fg); border: 1px solid var(--sonar-brand-border); background: var(--sonar-brand-bg);"
					>
						{busy ? 'Saving…' : hasDraftChanges ? 'Save draft' : 'Saved'}
					</button>
					<div class="text-xs" style="color: var(--sonar-text-muted);">
						Stage transitions auto-save drafts before applying.
					</div>
				</div>
			</section>

			<!-- Asana preview -->
			{#if currentStage === 'pm-review' || currentStage === 'triage'}
				<details class="rounded-lg border" style="border-color: var(--sonar-border); background: var(--sonar-panel);">
					<summary class="px-5 py-3 cursor-pointer text-xs uppercase tracking-wider" style="color: var(--sonar-text-muted);">
						Preview Asana task description
					</summary>
					<pre class="px-5 pb-5 text-xs whitespace-pre-wrap" style="color: var(--sonar-text);">{taskPreview}</pre>
				</details>
			{/if}

			<!-- Advance / Backtrack -->
			<section class="rounded-lg border p-5 flex flex-col gap-3" style="border-color: var(--sonar-border); background: var(--sonar-panel);">
				<div class="flex items-center gap-3 flex-wrap">
					{#if forwardTarget}
						<button
							type="button"
							onclick={() => advanceTo(forwardTarget)}
							disabled={busy || !advanceCheck.ok}
							title={advanceCheck.ok ? `Advance to ${STAGE_LABELS[forwardTarget]}` : advanceCheck.reason}
							class="px-4 py-2 text-sm rounded text-white disabled:opacity-50"
							style="background: var(--sonar-accent);"
						>
							{busy ? 'Working…' : `Advance to ${STAGE_LABELS[forwardTarget]} →`}
						</button>
						{#if !advanceCheck.ok}
							<span class="text-xs" style="color: var(--sonar-text-muted);">{advanceCheck.reason}</span>
						{/if}
					{:else}
						<span class="text-sm" style="color: var(--sonar-text-muted);">
							This ticket is at the final stage. Nothing to advance to.
						</span>
					{/if}
					{#if backwardTarget}
						<button
							type="button"
							onclick={() => (showBacktrackInput = !showBacktrackInput)}
							disabled={busy}
							class="px-3 py-2 text-sm rounded ml-auto disabled:opacity-50"
							style="color: var(--sonar-text); border: 1px solid var(--sonar-border); background: transparent;"
						>
							← Backtrack to {STAGE_LABELS[backwardTarget]}
						</button>
					{/if}
				</div>
				{#if showBacktrackInput && backwardTarget}
					<div
						class="rounded border p-3 flex flex-col gap-2"
						style="border-color: var(--sonar-border); background: var(--sonar-panel-2);"
					>
						<label class="flex flex-col gap-1">
							<span class="text-xs uppercase tracking-wider" style="color: var(--sonar-text-muted);">Reason for backtrack</span>
							<input
								type="text"
								bind:value={backtrackNote}
								placeholder="e.g. spec is incomplete; need more detail on edge cases"
								class="rounded border px-3 py-2 text-sm"
								style="border-color: var(--sonar-border); background: var(--sonar-panel); color: var(--sonar-text);"
							/>
						</label>
						<div class="flex items-center gap-2">
							<button
								type="button"
								onclick={() => advanceTo(backwardTarget, backtrackNote.trim() || undefined)}
								disabled={busy}
								class="px-3 py-1.5 text-sm rounded text-white disabled:opacity-50"
								style="background: #b91c1c;"
							>
								Confirm backtrack
							</button>
							<button
								type="button"
								onclick={() => (showBacktrackInput = false)}
								class="px-3 py-1.5 text-sm rounded"
								style="color: var(--sonar-text-muted); border: 1px solid var(--sonar-border);"
							>
								Cancel
							</button>
						</div>
					</div>
				{/if}
				{#if actionError}
					<div class="text-sm rounded border px-3 py-2" style="color: #b91c1c; border-color: #fecaca; background: #fef2f2;">
						{actionError}
					</div>
				{/if}
				{#if actionStatus}
					<div class="text-sm rounded border px-3 py-2" style="color: var(--sonar-brand-fg); border-color: var(--sonar-brand-border); background: var(--sonar-brand-bg);">
						{actionStatus}
					</div>
				{/if}
			</section>

			<!-- Audit log -->
			<section class="rounded-lg border p-5" style="border-color: var(--sonar-border); background: var(--sonar-panel);">
				<div class="text-xs uppercase tracking-wider mb-3" style="color: var(--sonar-text-muted);">Stage history</div>
				<StageHistoryLog history={bug.stageHistory ?? []} />
			</section>
		{/if}
	</main>
</div>
