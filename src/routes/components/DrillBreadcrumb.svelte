<script lang="ts">
	import type { Cluster } from '$lib/schemas';

	// Drill-down breadcrumb. Renders nothing when the user is at the top
	// level. Otherwise: a "N levels deep" depth chip followed by a chip
	// trail (Top › ancestors › current). Ancestor chips are buttons that
	// jump to that depth via onJump; the current-location chip is non-
	// interactive. Styles live in src/lib/styles/sonar.css
	// under the .sonar-breadcrumb* prefix so theme tokens work uniformly.
	type Props = {
		drillPath: Cluster[];
		onJump: (depth: number) => void;
		onReset: () => void;
	};
	let { drillPath, onJump, onReset }: Props = $props();
</script>

{#if drillPath.length > 0}
	<div class="sonar-breadcrumb">
		<span class="sonar-breadcrumb-depth" aria-label="Drill depth">
			<span class="sonar-breadcrumb-depth-num">{drillPath.length}</span>
			level{drillPath.length === 1 ? '' : 's'} deep
		</span>
		<div class="sonar-breadcrumb-trail">
			<button class="sonar-breadcrumb-chip" type="button" onclick={onReset} title="Back to top level">
				<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M3 12L12 3l9 9" />
					<path d="M5 10v10h6v-6h2v6h6V10" />
				</svg>
				Top
			</button>
			{#each drillPath as p, i (i + ':' + p.id)}
				<span class="sonar-breadcrumb-sep" aria-hidden="true">›</span>
				{#if i < drillPath.length - 1}
					<button class="sonar-breadcrumb-chip" type="button" onclick={() => onJump(i + 1)} title={p.label}>
						<span class="sonar-breadcrumb-chip-label">{p.label}</span>
					</button>
				{:else}
					<span class="sonar-breadcrumb-chip sonar-breadcrumb-chip-current" aria-current="page" title={p.label}>
						<span class="sonar-breadcrumb-chip-label">{p.label}</span>
					</span>
				{/if}
			{/each}
		</div>
	</div>
{/if}
