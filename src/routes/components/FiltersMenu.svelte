<script lang="ts">
	import { onMount } from 'svelte';
	import type { Cluster } from '$lib/schemas';
	import FiltersTabClusters from './FiltersTabClusters.svelte';

	// Header popover — clustering settings + cluster directory. The
	// per-bug filters (search, severity, status, area, source, people)
	// now live in the always-visible InlineFiltersBar; this menu only
	// houses things that aren't strictly filters: threshold, AI toggle,
	// and the searchable cluster list.
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
		onClose: () => void;
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
		onSelectCluster,
		onClose
	}: Props = $props();

	onMount(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	function selectAndClose(id: string) {
		onSelectCluster(id);
		onClose();
	}
</script>

<!-- Click-outside backdrop (transparent — feels like a popover, not modal). -->
<div role="presentation" class="fixed inset-0 z-40" onclick={onClose}></div>

<div
	role="dialog"
	aria-label="Clustering settings"
	class="fixed z-50 sonar-panel rounded-lg shadow-xl flex flex-col p-0"
	style="top: 72px; right: 24px; width: 360px; max-height: calc(100vh - 96px);"
>
	<div class="flex justify-between items-center px-4 pt-4 pb-3">
		<div class="text-sm font-medium sonar-text">Clustering settings</div>
		<button
			onclick={onClose}
			class="sonar-muted hover:sonar-text text-xl leading-none px-1"
			aria-label="Close"
		>×</button>
	</div>

	<div class="px-4 pt-2 pb-4 overflow-y-auto" style="max-height: calc(100vh - 96px - 60px);">
		<FiltersTabClusters
			{threshold}
			{useAi}
			{sortedClusters}
			{hotIds}
			{selectedId}
			{onSetThreshold}
			{onSetUseAi}
			{onReload}
			onSelectCluster={selectAndClose}
		/>
	</div>
</div>
