/**
 * Page-level view helpers extracted from +page.svelte's script block so it
 * can stay under the 500-line budget. These are pure functions that map
 * (clusters, bugs) → derived view state, so they're safe to import on the
 * client and easy to unit-test in isolation if/when we add tests.
 */
import type { Bug, Cluster } from './schemas';

/**
 * Count of unresolved-high bugs per cluster, used to drive the "hot"
 * pulsing indicator on the radar. Only clusters with at least one
 * matching bug appear in the result; everything else is implicitly
 * "not hot".
 */
export function computeHotCounts(clusters: Cluster[], bugs: Bug[]): Map<string, number> {
	const byId = new Map(bugs.map((b) => [b._id, b]));
	const out = new Map<string, number>();
	for (const c of clusters) {
		let n = 0;
		for (const id of c.bugIds) {
			const b = byId.get(id);
			if (b && b.severity === 'high' && (b.status ?? 'open') !== 'resolved') n++;
		}
		if (n > 0) out.set(c.id, n);
	}
	return out;
}

/**
 * Hover-sync dispatcher: maps an (kind, value) tuple coming from the
 * right-panel hover handlers to the set of cluster ids that should
 * light up on the radar.
 *  - cluster → that cluster only
 *  - area    → every cluster whose primaryArea matches
 *  - bug     → the single cluster containing that bug
 *  - null/empty value → no highlight
 */
export type HighlightKind = 'cluster' | 'area' | 'bug' | null;

export function computeHighlightedClusterIds(
	kind: HighlightKind,
	value: string | undefined,
	clusters: Cluster[]
): Set<string> {
	if (!kind || !value) return new Set();
	if (kind === 'cluster') return new Set([value]);
	if (kind === 'area') {
		return new Set(clusters.filter((c) => c.primaryArea === value).map((c) => c.id));
	}
	const c = clusters.find((c) => c.bugIds.includes(value));
	return c ? new Set([c.id]) : new Set();
}
