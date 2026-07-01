<script lang="ts">
	/**
	 * Vertical audit log of every stage transition this bug has walked.
	 * Newest first. Renders an empty-state line when the bug hasn't moved
	 * yet (legacy doc, or freshly filed).
	 */
	import { STAGE_LABELS } from '$lib/stages';
	import type { StageHistoryEntry } from '$lib/schemas';

	type Props = { history: StageHistoryEntry[] };
	let { history }: Props = $props();

	const reversed = $derived([...history].reverse());

	const formatTime = (iso: string): string => {
		const d = new Date(iso);
		return d.toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	};
</script>

{#if reversed.length === 0}
	<div class="text-xs italic" style="color: var(--sonar-text-muted);">
		No transitions yet — this ticket is fresh out of triage.
	</div>
{:else}
	<ol class="flex flex-col gap-2">
		{#each reversed as h, i (i + ':' + h.at)}
			<li
				class="rounded border px-3 py-2 text-xs"
				style="border-color: var(--sonar-border); background: var(--sonar-panel-2);"
			>
				<div class="flex items-center justify-between gap-2 mb-0.5">
					<div class="font-medium" style="color: var(--sonar-text);">
						{h.from ? STAGE_LABELS[h.from] : '(initial)'} → {STAGE_LABELS[h.to]}
					</div>
					<div style="color: var(--sonar-text-muted);">{formatTime(h.at)}</div>
				</div>
				<div style="color: var(--sonar-text-muted);">
					by <span style="color: var(--sonar-text);">{h.by}</span>
				</div>
				{#if h.note}
					<div class="mt-1" style="color: var(--sonar-text);">
						<span style="color: var(--sonar-text-muted);">note:</span>
						{h.note}
					</div>
				{/if}
			</li>
		{/each}
	</ol>
{/if}
