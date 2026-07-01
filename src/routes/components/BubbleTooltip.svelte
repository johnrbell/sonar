<script lang="ts">
	import type { Cluster } from '$lib/schemas';

	// Pure presentation. State (mount/unmount + position) lives in BubbleViz;
	// this component just renders the markup when given a non-null tooltip.
	// Styles live in src/lib/styles/sonar.css (global) so
	// the page imports them once and every sonar component picks them up.
	type TooltipModel = {
		x: number;
		y: number;
		flipped: boolean;
		cluster: Cluster & { drillable?: boolean };
	};
	let { tooltip }: { tooltip: TooltipModel | null } = $props();
</script>

{#if tooltip}
	<div
		class="sonar-bubble-tooltip"
		class:flipped={tooltip.flipped}
		style="left: {tooltip.x}px; top: {tooltip.y}px;"
	>
		<div class="sonar-tt-label">{tooltip.cluster.label}</div>
		<div class="sonar-tt-meta">
			{tooltip.cluster.primaryArea} · {tooltip.cluster.bugIds.length} bug{tooltip.cluster.bugIds.length === 1 ? '' : 's'}
		</div>
		{#if tooltip.cluster.drillable}
			<div class="sonar-tt-hint">Click to zoom in</div>
		{/if}
	</div>
{/if}
