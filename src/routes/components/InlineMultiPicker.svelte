<script lang="ts">
	import { untrack } from 'svelte';

	// Inline multi-select trigger + popover. The trigger is a compact pill
	// that lives in the InlineFiltersBar; the popover floats below it with
	// a typeahead + scrollable list of pills.
	//
	// We render the popover via `position: fixed` and recompute its anchor
	// on open/scroll/resize so the bar can sit inside an overflow container
	// without the popover getting clipped.
	type Option = { value: string; label?: string; count?: number };
	type Props = {
		label: string;
		options: Option[];
		selected: Set<string>;
		onToggle: (value: string) => void;
		onClear?: () => void;
		// Show the typeahead field whenever options exceed this count.
		searchAfter?: number;
		// Optional sentinel pill rendered at the top (e.g. "(unassigned)").
		noneSentinel?: { value: string; label: string; show: boolean };
	};
	let {
		label,
		options,
		selected,
		onToggle,
		onClear,
		searchAfter = 6,
		noneSentinel
	}: Props = $props();

	let open = $state(false);
	let query = $state('');
	let btnEl: HTMLButtonElement | null = $state(null);
	let popoverEl: HTMLDivElement | null = $state(null);
	let anchor = $state<{ top: number; left: number; minWidth: number } | null>(null);

	const visibleOptions = $derived(
		query.trim() === ''
			? options
			: options.filter((o) => {
					const txt = (o.label ?? o.value).toLowerCase();
					return txt.includes(query.trim().toLowerCase()) || selected.has(o.value);
				})
	);

	function reanchor() {
		if (!btnEl) return;
		const r = btnEl.getBoundingClientRect();
		anchor = { top: r.bottom + 6, left: r.left, minWidth: Math.max(r.width, 220) };
	}

	function close() {
		open = false;
		query = '';
	}

	function onDocClick(e: MouseEvent) {
		const t = e.target as Node;
		if (btnEl?.contains(t) || popoverEl?.contains(t)) return;
		close();
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}

	$effect(() => {
		if (!open) return;
		untrack(() => reanchor());
		window.addEventListener('scroll', reanchor, true);
		window.addEventListener('resize', reanchor);
		document.addEventListener('mousedown', onDocClick);
		document.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('scroll', reanchor, true);
			window.removeEventListener('resize', reanchor);
			document.removeEventListener('mousedown', onDocClick);
			document.removeEventListener('keydown', onKey);
		};
	});

	const count = $derived(selected.size);
	const showSearch = $derived(options.length > searchAfter || query !== '');
</script>

<button
	type="button"
	bind:this={btnEl}
	onclick={() => (open ? close() : (open = true))}
	class="sonar-inline-filter-btn"
	class:is-active={count > 0}
	class:is-open={open}
	aria-haspopup="listbox"
	aria-expanded={open}
>
	<span class="sonar-inline-filter-btn-label">{label}</span>
	{#if count > 0}
		<span class="sonar-inline-filter-btn-count">{count}</span>
	{/if}
	<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<polyline points="6 9 12 15 18 9" />
	</svg>
</button>

{#if open && anchor}
	<div
		bind:this={popoverEl}
		class="sonar-inline-filter-popover"
		role="dialog"
		aria-label="{label} filter"
		style="top: {anchor.top}px; left: {anchor.left}px; min-width: {anchor.minWidth}px;"
	>
		{#if showSearch}
			<input
				type="search"
				placeholder="Search {label.toLowerCase()}…"
				bind:value={query}
				class="sonar-input sonar-inline-filter-search"
				aria-label="Search {label.toLowerCase()}"
			/>
		{/if}
		<div class="sonar-inline-filter-list">
			{#if noneSentinel?.show}
				<button
					type="button"
					onclick={() => onToggle(noneSentinel.value)}
					class="sonar-pill px-2 py-1 text-xs rounded-full border"
					class:sonar-pill-active={selected.has(noneSentinel.value)}
				>
					<span class="italic">{noneSentinel.label}</span>
				</button>
			{/if}
			{#each visibleOptions as o (o.value)}
				<button
					type="button"
					onclick={() => onToggle(o.value)}
					class="sonar-pill px-2 py-1 text-xs rounded-full border inline-flex items-center gap-1"
					class:sonar-pill-active={selected.has(o.value)}
					title={o.label ?? o.value}
				>
					<span class="truncate" style="max-width: 160px;">{o.label ?? o.value}</span>
					{#if o.count !== undefined}<span class="opacity-60">{o.count}</span>{/if}
				</button>
			{:else}
				<span class="text-xs sonar-muted italic px-1 py-1">No matches</span>
			{/each}
		</div>
		{#if count > 0 && onClear}
			<div class="sonar-inline-filter-footer">
				<button
					type="button"
					onclick={() => { onClear(); }}
					class="text-xs sonar-muted hover:underline"
				>Clear {label.toLowerCase()}</button>
			</div>
		{/if}
	</div>
{/if}
