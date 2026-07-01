// In-memory data store. This standalone build has no database — the app boots
// from a synthetic seed JSON and keeps all writes in process memory. Everything
// resets on restart, which is exactly the intended behavior for a demo.
import type { Bug } from './schemas';
import { normalizeBugAreas } from './constants';
import seedBugs from './seed-bugs.json';

// Bugs created via the form/API land here so the cluster view updates live.
let runtimeBugs: Bug[] = [];
// Soft-delete set for seed bugs. The seed JSON is an import — we can't mutate
// it — so deletes against seed ids just mark them excluded. Lives for the
// process lifetime (resets on restart).
const tombstones = new Set<string>();
export function getRuntimeBugs(): Bug[] {
	return runtimeBugs.map(normalizeBugAreas);
}
export function addRuntimeBug(b: Bug): void {
	runtimeBugs.unshift(b);
}
export function resetRuntimeBugs(): void {
	runtimeBugs = [];
	tombstones.clear();
}
export function deleteMockBug(id: string): boolean {
	const rtIdx = runtimeBugs.findIndex((b) => b._id === id);
	if (rtIdx >= 0) {
		runtimeBugs.splice(rtIdx, 1);
		return true;
	}
	const seed = (seedBugs as Bug[]).find((b) => b._id === id);
	if (!seed) return false;
	tombstones.add(id);
	return true;
}

// Update — clones a seed bug into the runtime store on first touch so
// subsequent reads (which concat runtime + seed) reflect the change. Returns
// the updated bug, or null if the id doesn't exist.
export function updateMockBug(id: string, patch: Partial<Bug>): Bug | null {
	const rt = runtimeBugs.findIndex((b) => b._id === id);
	if (rt >= 0) {
		runtimeBugs[rt] = { ...runtimeBugs[rt], ...patch };
		return runtimeBugs[rt];
	}
	const seed = (seedBugs as Bug[]).find((b) => b._id === id);
	if (!seed) return null;
	const cloned: Bug = { ...seed, ...patch };
	runtimeBugs.unshift(cloned);
	return cloned;
}

export function findMockBug(id: string): Bug | null {
	if (tombstones.has(id)) return null;
	const hit =
		runtimeBugs.find((b) => b._id === id) ??
		((seedBugs as Bug[]).find((b) => b._id === id) ?? null);
	return hit ? normalizeBugAreas(hit) : null;
}

// ~40 synthetic seed bugs for a fictional SaaS app ("Nimbus"), spread across
// the feature areas in constants.ts with a handful of intentional natural
// clusters (SSO redirect loops, dashboard widgets stuck loading, duplicate
// notification emails, large-file upload timeouts, etc.). The rest are
// singletons. Data lives in ./seed-bugs.json so it's easy to edit/regenerate.
export function getMockBugs(): Bug[] {
	// Filter out tombstoned seeds AND any seed whose id has been cloned
	// into runtimeBugs by a prior updateMockBug() — otherwise the cluster
	// endpoint sees both the stale seed AND the updated runtime copy, and
	// the same bug shows up twice (e.g. once in clusters, once in archive).
	const runtimeIds = new Set(runtimeBugs.map((b) => b._id));
	return (seedBugs as Bug[])
		.filter((b) => !tombstones.has(b._id) && !runtimeIds.has(b._id))
		.map(normalizeBugAreas);
}
