import type { Bug, IntakeType, Severity, Status } from './schemas';

// Filter dimensions managed by the FiltersMenu. Lives here (not in
// schemas.ts) because it's a UI-state shape, not a wire/storage contract.
export type FilterState = {
	searchText: string;
	sourceFilter: '' | 'internal' | 'public' | 'slack';
	areaFilter: string;
	severityFilter: Set<Severity>;
	statusFilter: Set<Status>;
	intakeTypeFilter: Set<IntakeType>;
	reporterFilter: Set<string>;
	responderFilter: Set<string>;
	assigneeFilter: Set<string>;
};

// Sentinel used in `assigneeFilter` to mean "bugs with no assignee."
// Mirrored by the (unassigned) sentinel pill in InlineFiltersBar's Owner picker.
export const UNASSIGNED_SENTINEL = '__none__';

// Single bug-filter predicate. Returns true if the bug passes every active
// filter (empty / unset filters are always permissive). All filter
// dimensions are AND-ed together; multi-select dimensions are OR-ed within
// themselves (any selected reporter matches).
export function matchesFilters(b: Bug, f: FilterState): boolean {
	if (f.sourceFilter && b.source !== f.sourceFilter) return false;
	if (f.areaFilter && !b.areas.includes(f.areaFilter as never)) return false;
	if (f.severityFilter.size > 0 && !f.severityFilter.has(b.severity)) return false;
	if (f.statusFilter.size > 0 && !f.statusFilter.has(b.status ?? 'open')) return false;
	if (f.intakeTypeFilter.size > 0 && !f.intakeTypeFilter.has(b.intakeType ?? 'bug')) return false;
	if (f.reporterFilter.size > 0 && !f.reporterFilter.has(b.reporter)) return false;
	if (f.responderFilter.size > 0) {
		const rs = b.responders ?? [];
		if (!rs.some((r) => f.responderFilter.has(r))) return false;
	}
	if (f.assigneeFilter.size > 0) {
		// Bugs with no assignee only match when the user opted in via the
		// "(unassigned)" sentinel.
		if (!b.assignee) {
			if (!f.assigneeFilter.has(UNASSIGNED_SENTINEL)) return false;
		} else if (!f.assigneeFilter.has(b.assignee)) {
			return false;
		}
	}
	const q = f.searchText.trim().toLowerCase();
	if (q) {
		const hay = `${b.title} ${b.description}`.toLowerCase();
		if (!hay.includes(q)) return false;
	}
	return true;
}

// Frequency-ranked unique values for the people pickers. Returns
// [value, count] tuples sorted by count desc, most-frequent first.
// Empty / falsy values are dropped.
export function freqRank(values: string[]): Array<[string, number]> {
	const counts = new Map<string, number>();
	for (const v of values) {
		if (!v) continue;
		counts.set(v, (counts.get(v) ?? 0) + 1);
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// Toggle a value in/out of a Set, returning a NEW Set so Svelte 5
// reactivity picks up the change. Mutating in place wouldn't trigger
// $derived consumers.
export function toggleInSet<T>(s: Set<T>, v: T): Set<T> {
	const next = new Set(s);
	if (next.has(v)) next.delete(v);
	else next.add(v);
	return next;
}

// Empty FilterState — used by "Clear all filters" actions. Threshold + AI
// are clustering parameters and aren't reset here on purpose.
export function emptyFilterState(): FilterState {
	return {
		searchText: '',
		sourceFilter: '',
		areaFilter: '',
		severityFilter: new Set(),
		statusFilter: new Set(),
		intakeTypeFilter: new Set(),
		reporterFilter: new Set(),
		responderFilter: new Set(),
		assigneeFilter: new Set()
	};
}
