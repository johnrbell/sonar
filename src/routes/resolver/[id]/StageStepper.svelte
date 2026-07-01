<script lang="ts">
	/**
	 * Horizontal 5-dot stepper. Dots are display-only; advancing happens
	 * via the explicit [Advance to <next>] button below the editor.
	 *
	 * Hover on any dot shows that stage's gate requirements (read from
	 * stages.ts via the parent — we accept a `tooltipFor(stage)` callback
	 * so this component stays presentational).
	 */
	import { STAGE_ORDER, STAGE_LABELS } from '$lib/stages';
	import type { Stage } from '$lib/schemas';

	type Props = {
		current: Stage;
		tooltipFor?: (s: Stage) => string;
	};
	let { current, tooltipFor }: Props = $props();

	const currentIndex = $derived(STAGE_ORDER.indexOf(current));
</script>

<div class="flex items-center gap-2 w-full">
	{#each STAGE_ORDER as s, i (s)}
		{@const reached = i <= currentIndex}
		{@const isCurrent = i === currentIndex}
		<div class="flex items-center flex-shrink-0">
			<div
				class="flex flex-col items-center"
				title={tooltipFor?.(s) ?? STAGE_LABELS[s]}
			>
				<div
					class="rounded-full border-2 transition-all"
					style="
						width: {isCurrent ? '14px' : '10px'};
						height: {isCurrent ? '14px' : '10px'};
						background: {reached ? 'var(--sonar-accent)' : 'var(--sonar-panel)'};
						border-color: {reached ? 'var(--sonar-accent)' : 'var(--sonar-border)'};
						box-shadow: {isCurrent ? '0 0 0 4px rgba(74, 30, 227, 0.15)' : 'none'};
					"
				></div>
				<div
					class="text-[10px] mt-1.5 uppercase tracking-wider whitespace-nowrap"
					style="color: {reached ? 'var(--sonar-text)' : 'var(--sonar-text-muted)'}; font-weight: {isCurrent ? 600 : 400};"
				>
					{STAGE_LABELS[s]}
				</div>
			</div>
		</div>
		{#if i < STAGE_ORDER.length - 1}
			<div
				class="flex-1 h-0.5 mb-4"
				style="background: {i < currentIndex ? 'var(--sonar-accent)' : 'var(--sonar-border)'};"
			></div>
		{/if}
	{/each}
</div>
