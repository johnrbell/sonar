<script lang="ts">
	// The purple top bar: brand mark, live counts, filter + theme buttons,
	// "Log a bug" CTA, and sign out.
	import { goto } from '$app/navigation';

	type Props = {
		mode: 'local' | 'ai';
		theme: 'light' | 'dark';
		visibleBugCount: number;
		nonSingleton: number;
		taggedAreaCount: number;
		activeFilterCount: number;
		onToggleFilters: () => void;
		onToggleTheme: () => void;
		onLogBug: () => void;
	};
	let {
		mode,
		theme,
		visibleBugCount,
		nonSingleton,
		taggedAreaCount,
		activeFilterCount,
		onToggleFilters,
		onToggleTheme,
		onLogBug
	}: Props = $props();

	async function signOut() {
		await fetch('/api/logout', { method: 'POST' }).catch(() => {});
		await goto('/login', { invalidateAll: true });
	}
</script>

<header class="sonar-header">
	<div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
		<div class="flex items-center gap-3">
			<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-white">
				<circle cx="12" cy="12" r="3" />
				<circle cx="12" cy="12" r="7" stroke-opacity="0.6" />
				<circle cx="12" cy="12" r="11" stroke-opacity="0.35" />
				<line x1="12" y1="12" x2="20" y2="6" stroke-width="1.5" />
			</svg>
			<div>
				<div class="text-lg font-medium text-white">Sonar</div>
				<div class="text-xs text-white/70">Bug & feedback radar · mode: {mode}</div>
			</div>
		</div>
		<div class="flex items-center gap-4">
			<div class="text-xs text-white/80 flex gap-4">
				<span>{visibleBugCount} bugs</span>
				<span>{nonSingleton} clusters</span>
				<span>{taggedAreaCount} areas tagged</span>
			</div>
			<button
				onclick={onToggleFilters}
				aria-label="Filters and clusters"
				class="text-white/85 hover:text-white transition p-1.5 rounded hover:bg-white/10 inline-flex items-center gap-1.5"
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="9" y1="18" x2="15" y2="18"/></svg>
				<span class="text-xs">Filters</span>
				{#if activeFilterCount > 0}
					<span class="inline-flex items-center justify-center text-[10px] font-medium rounded-full bg-white text-[#4a1ee3]" style="min-width: 16px; height: 16px; padding: 0 4px;">{activeFilterCount}</span>
				{/if}
			</button>
			<button onclick={onToggleTheme} aria-label="Toggle theme" class="text-white/85 hover:text-white transition p-1.5 rounded hover:bg-white/10">
				{#if theme === 'light'}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
				{:else}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
				{/if}
			</button>
			<button onclick={onLogBug} class="bg-white text-[#4a1ee3] hover:bg-white/90 text-sm font-medium px-4 py-2 rounded">+ Log a bug</button>
			<span class="h-5 w-px bg-white/25" aria-hidden="true"></span>
			<button onclick={signOut} class="text-xs text-white/70 hover:text-white transition-colors">Sign out</button>
		</div>
	</div>
</header>
