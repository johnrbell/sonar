/**
 * Drill-down navigation handlers for the Sonar radar.
 *
 * Factored out of +page.svelte (which was bumping the 500-line cap) following
 * the same getter/setter-injection pattern as makeBugActions and
 * makeSplitDragHandlers: the page owns the $state, this module owns the
 * transition logic. Keeping the drill state machine in one place also makes the
 * "zoom in → commit → push onto drillPath" / "pop → reverse-zoom" choreography
 * easy to reason about without the surrounding page noise.
 */
import type { Cluster } from '$lib/schemas';

// Cap drill depth to stop runaway re-clustering on pathological inputs.
export const MAX_DRILL_DEPTH = 4;
// Zoom-in / reverse-zoom animation window. The page waits this long before
// committing a drill so the bubble scale-up reads as a transition.
export const ZOOM_ANIM_MS = 420;

type AnnotatedCluster = Cluster & { drillable: boolean };

interface DrillDeps {
	getAnnotatedClusters: () => AnnotatedCluster[];
	getDrillPath: () => Cluster[];
	setDrillPath: (path: Cluster[]) => void;
	setSelectedId: (id: string | null) => void;
	setZoomingId: (id: string | null) => void;
	setZoomingBackToId: (id: string | null) => void;
}

export function makeDrillHandlers(deps: DrillDeps) {
	// Select clicked cluster; if drillable, run the zoom (ZOOM_ANIM_MS), then
	// commit by pushing a plain Cluster snapshot onto drillPath.
	async function onBubbleClick(id: string) {
		deps.setSelectedId(id);
		const c = deps.getAnnotatedClusters().find((x) => x.id === id);
		if (!c || !c.drillable) return;
		deps.setZoomingId(id);
		await new Promise((r) => setTimeout(r, ZOOM_ANIM_MS));
		const { id: _id, label, primaryArea, areas, severity, bugIds } = c;
		deps.setDrillPath([...deps.getDrillPath(), { id: _id, label, primaryArea, areas, severity, bugIds }]);
		deps.setSelectedId(null);
		deps.setZoomingId(null);
	}

	function drillBack() {
		const path = deps.getDrillPath();
		if (path.length === 0) return;
		const popped = path[path.length - 1]; // capture id BEFORE pop (reverse zoom)
		deps.setDrillPath(path.slice(0, -1));
		deps.setSelectedId(null);
		deps.setZoomingBackToId(popped.id);
		setTimeout(() => deps.setZoomingBackToId(null), ZOOM_ANIM_MS);
	}

	function drillJump(depth: number) {
		// depth = 0 → back to top; depth = drillPath.length-1 → no-op.
		const path = deps.getDrillPath();
		if (depth < 0 || depth >= path.length) return;
		deps.setDrillPath(path.slice(0, depth));
		deps.setSelectedId(null);
	}

	function drillReset() {
		deps.setDrillPath([]);
		deps.setSelectedId(null);
	}

	return { onBubbleClick, drillBack, drillJump, drillReset };
}
