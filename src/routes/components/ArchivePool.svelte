<script lang="ts">
	// Pinned grayscale "Archived" bubble that sits in the bottom-right
	// corner of the radar at every drill level. Two jobs:
	//   1) Drop target — accepts bug cards dragged from the right-side
	//      cluster panel and calls onArchive(bugId).
	//   2) Click target — opens the archive viewer in the right panel
	//      via onSelect() without disturbing the current drill state.
	//
	// It lives OUTSIDE the d3 force simulation (sibling of the <svg>) so
	// it never gets pushed around by clusters and stays pinned even when
	// the bubble layout reflows.
	type Props = {
		count: number;
		active: boolean;
		onArchive: (bugId: string) => void;
		onSelect: () => void;
	};
	let { count, active, onArchive, onSelect }: Props = $props();

	// `isDropTarget` tracks the dragenter/dragleave window so the bubble
	// can light up while the cursor is over it. We use a ref-counted
	// enter/leave because dragenter/dragleave fire on every child as the
	// cursor traverses, which would otherwise flicker the highlight.
	let isDropTarget = $state(false);
	let dragDepth = 0;

	function onDragEnter(e: DragEvent) {
		// Only react to drags that carry our custom MIME — ignores
		// arbitrary OS-level drags (files, text selection, etc.).
		if (!hasBugPayload(e)) return;
		e.preventDefault();
		dragDepth += 1;
		isDropTarget = true;
	}
	function onDragOver(e: DragEvent) {
		if (!hasBugPayload(e)) return;
		// Calling preventDefault is what flips the cursor to "copy" and
		// allows the subsequent drop event to fire at all.
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
	}
	function onDragLeave(e: DragEvent) {
		if (!hasBugPayload(e)) return;
		dragDepth -= 1;
		if (dragDepth <= 0) {
			dragDepth = 0;
			isDropTarget = false;
		}
	}
	function onDrop(e: DragEvent) {
		const bugId = e.dataTransfer?.getData('text/x-sonar-bug-id');
		dragDepth = 0;
		isDropTarget = false;
		if (!bugId) return;
		e.preventDefault();
		onArchive(bugId);
	}

	// dataTransfer.types is the only thing readable during dragover (the
	// actual data is protected until drop), so we sniff by MIME presence.
	function hasBugPayload(e: DragEvent): boolean {
		const types = e.dataTransfer?.types;
		if (!types) return false;
		for (let i = 0; i < types.length; i++) {
			if (types[i] === 'text/x-sonar-bug-id') return true;
		}
		return false;
	}
</script>

<button
	type="button"
	class="sonar-archive-pool"
	class:is-drop-target={isDropTarget}
	class:is-active={active}
	class:is-empty={count === 0}
	onclick={onSelect}
	ondragenter={onDragEnter}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
	aria-label={`Archived bugs (${count}). Drop a bug card here to archive it, or click to view archived bugs.`}
	title={count === 0
		? 'Archive — drop a bug card here'
		: `${count} archived bug${count === 1 ? '' : 's'} — click to view, or drop a card to archive`}
>
	<div class="sonar-archive-pool-inner">
		<div class="sonar-archive-pool-count">{count}</div>
		<div class="sonar-archive-pool-label">Archived</div>
		{#if isDropTarget}
			<div class="sonar-archive-pool-hint">Drop to archive</div>
		{/if}
	</div>
</button>
