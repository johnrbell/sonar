// Resize-handle drag + keyboard logic for the sonar two-column layout.
// Pulled out of +page.svelte so it doesn't take up real estate next to
// the actual feature code. Returns a small object of pointer/key handlers
// the page wires onto the <div class="sonar-split-handle"> separator.
//
// Persists the chosen split ratio to localStorage under `sonar.split` so
// the user's preferred column width survives reloads.

export const SPLIT_MIN = 0.25;
export const SPLIT_MAX = 0.75;
export const SPLIT_STORAGE_KEY = 'sonar.split';

export type SplitDragState = {
	getRatio: () => number;
	setRatio: (r: number) => void;
	getLayoutEl: () => HTMLElement | null;
	setDragging: (b: boolean) => void;
	isDragging: () => boolean;
};

function clamp(ratio: number): number {
	return Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, ratio));
}

function persist(ratio: number): void {
	try {
		localStorage.setItem(SPLIT_STORAGE_KEY, String(ratio));
	} catch {
		// localStorage may be unavailable (private mode, etc.) — ignore.
	}
}

export function makeSplitDragHandlers(state: SplitDragState) {
	return {
		onPointerDown(e: PointerEvent) {
			state.setDragging(true);
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
			document.body.style.userSelect = 'none';
		},
		onPointerMove(e: PointerEvent) {
			const el = state.getLayoutEl();
			if (!state.isDragging() || !el) return;
			const rect = el.getBoundingClientRect();
			state.setRatio(clamp((e.clientX - rect.left) / rect.width));
		},
		onPointerUp(e: PointerEvent) {
			if (!state.isDragging()) return;
			state.setDragging(false);
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
			document.body.style.userSelect = '';
			persist(state.getRatio());
		},
		onKeyDown(e: KeyboardEvent) {
			if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
			e.preventDefault();
			const delta = e.key === 'ArrowLeft' ? -0.05 : 0.05;
			const next = clamp(state.getRatio() + delta);
			state.setRatio(next);
			persist(next);
		}
	};
}
