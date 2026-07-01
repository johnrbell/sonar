<script lang="ts">
	import type { Cluster } from '$lib/schemas';
	import { DIGEST_SLACK_CHANNEL } from '$lib/constants';

	// Clustering settings + cluster directory. Threshold and AI mode drive
	// the server-side clustering — changing them re-fires load() in the
	// parent. The cluster list is read-only; clicking jumps focus + closes.
	type Props = {
		threshold: number;
		useAi: boolean;
		sortedClusters: Cluster[];
		hotIds: Set<string>;
		selectedId: string | null;
		onSetThreshold: (n: number) => void;
		onSetUseAi: (v: boolean) => void;
		onReload: () => void;
		onSelectCluster: (id: string) => void;
	};
	let {
		threshold,
		useAi,
		sortedClusters,
		hotIds,
		selectedId,
		onSetThreshold,
		onSetUseAi,
		onReload,
		onSelectCluster
	}: Props = $props();
</script>

<div class="flex flex-col gap-4">
	<div>
		<label for="sf-thresh" class="block text-xs uppercase tracking-wider sonar-muted mb-1">Similarity threshold</label>
		<input
			id="sf-thresh"
			type="range"
			min="0.15"
			max="0.55"
			step="0.02"
			value={threshold}
			oninput={(e) => onSetThreshold(parseFloat((e.currentTarget as HTMLInputElement).value))}
			onchange={onReload}
			class="w-full accent-[#4a1ee3]"
		/>
		<div class="flex justify-between text-xs sonar-muted mt-1">
			<span>Loose</span><span>{threshold.toFixed(2)}</span><span>Tight</span>
		</div>
	</div>

	<label class="flex items-center gap-2 text-sm sonar-text">
		<input
			type="checkbox"
			checked={useAi}
			onchange={(e) => { onSetUseAi((e.currentTarget as HTMLInputElement).checked); onReload(); }}
			class="accent-[#4a1ee3]"
		/>
		Use Anthropic clustering (when key is set)
	</label>

	<div class="border-t sonar-divider pt-3">
		<div class="text-xs uppercase tracking-wider sonar-muted mb-2">Clusters (hot first)</div>
		<div class="flex flex-col gap-1 max-h-72 overflow-y-auto">
			{#each sortedClusters as c (c.id)}
				<button
					type="button"
					onclick={() => onSelectCluster(c.id)}
					class="sonar-row text-left text-sm px-2 py-1.5 rounded flex justify-between items-center gap-2"
					class:sonar-row-active={selectedId === c.id}
				>
					{#if hotIds.has(c.id)}
						<span aria-hidden="true" class="inline-block w-1.5 h-1.5 rounded-full" style="background: #ef4444; box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.18);"></span>
					{/if}
					<span class="truncate flex-1">{c.label}</span>
					<span class="text-xs sonar-muted">{c.bugIds.length}</span>
				</button>
			{:else}
				<div class="text-xs sonar-muted py-2">No clusters yet.</div>
			{/each}
		</div>
	</div>

	<div class="border-t sonar-divider pt-3 text-xs sonar-muted leading-relaxed">
		<div class="uppercase tracking-wider mb-1">Digest channel</div>
		<a
			href="https://slack.com/app_redirect?channel={DIGEST_SLACK_CHANNEL.replace(/^#/, '')}"
			target="_blank"
			rel="noopener noreferrer"
			class="font-mono text-[11px] hover:underline"
			style="color: var(--sonar-accent);"
		>{DIGEST_SLACK_CHANNEL}</a>
		<div class="mt-1">Weekly digest target; also where P0 hotspots ping.</div>
	</div>
</div>
