/**
 * URL deep-linking for Sonar.
 *
 * Sync'd to the URL (read on mount, written on change via replaceState):
 *   - Search text                ?q=<text>
 *   - Source single-select       ?source=internal|public|slack
 *   - Area single-select         ?area=<area>
 *   - Severity multi-select      ?severity=low,medium,high
 *   - Status multi-select        ?status=open,in-progress,resolved
 *   - Intake-type multi-select   ?type=bug,feature,question
 *   - Reporter multi-select      ?reporter=John%20Bell,...
 *   - Tagged (responder) multi   ?tagged=...
 *   - Owner (assignee) multi     ?owner=...
 *   - AI clustering toggle       ?ai=true
 *   - Cluster threshold          ?threshold=0.35 (only when non-default)
 *   - Archive overlay            ?view=archive
 *
 * Read-only on mount (doesn't auto-update as you navigate):
 *   - Focused bug id             ?bug=<id>  (caller selects the cluster +
 *                                            scroll/flash via openBugFromOverview)
 *
 * NOT in the URL:
 *   - Theme + split-ratio (per-user prefs, stored in localStorage)
 *   - drillPath / selectedId    (cluster ids regenerate on every /cluster
 *                                fetch — not stable enough to deep-link)
 */
import type { IntakeType, Severity, Status } from './schemas';

export type SourceFilter = '' | 'internal' | 'public' | 'slack';

export interface SonarUrlSnapshot {
	searchText: string;
	sourceFilter: SourceFilter;
	areaFilter: string;
	severityFilter: Set<Severity>;
	statusFilter: Set<Status>;
	intakeTypeFilter: Set<IntakeType>;
	reporterFilter: Set<string>;
	responderFilter: Set<string>;
	assigneeFilter: Set<string>;
	useAi: boolean;
	threshold: number;
	defaultThreshold: number;
	archiveView: boolean;
}

const SEVERITIES: readonly Severity[] = ['low', 'medium', 'high'];
const STATUSES: readonly Status[] = ['open', 'in-progress', 'resolved'];
const INTAKE_TYPES: readonly IntakeType[] = ['bug', 'feature', 'question'];

function csvSet<T extends string>(value: string | null, valid?: readonly T[]): Set<T> {
	if (!value) return new Set();
	const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
	if (valid) {
		const allowed = new Set<string>(valid);
		return new Set(parts.filter((p): p is T => allowed.has(p)));
	}
	return new Set(parts as T[]);
}

function setToCsv(s: Set<string>): string {
	return [...s].join(',');
}

export interface ParsedUrlState {
	searchText?: string;
	sourceFilter?: SourceFilter;
	areaFilter?: string;
	severityFilter?: Set<Severity>;
	statusFilter?: Set<Status>;
	intakeTypeFilter?: Set<IntakeType>;
	reporterFilter?: Set<string>;
	responderFilter?: Set<string>;
	assigneeFilter?: Set<string>;
	useAi?: boolean;
	threshold?: number;
	archiveView?: boolean;
	bugId?: string;
}

export function parseSonarUrlState(params: URLSearchParams): ParsedUrlState {
	const out: ParsedUrlState = {};
	const q = params.get('q'); if (q) out.searchText = q;
	const src = params.get('source');
	if (src === 'internal' || src === 'public' || src === 'slack') out.sourceFilter = src;
	const area = params.get('area'); if (area) out.areaFilter = area;
	const sev = csvSet<Severity>(params.get('severity'), SEVERITIES);
	if (sev.size > 0) out.severityFilter = sev;
	const st = csvSet<Status>(params.get('status'), STATUSES);
	if (st.size > 0) out.statusFilter = st;
	const tp = csvSet<IntakeType>(params.get('type'), INTAKE_TYPES);
	if (tp.size > 0) out.intakeTypeFilter = tp;
	const rep = csvSet(params.get('reporter')); if (rep.size > 0) out.reporterFilter = rep;
	const tag = csvSet(params.get('tagged')); if (tag.size > 0) out.responderFilter = tag;
	const own = csvSet(params.get('owner')); if (own.size > 0) out.assigneeFilter = own;
	if (params.get('ai') === 'true') out.useAi = true;
	const t = params.get('threshold');
	if (t) { const n = parseFloat(t); if (!Number.isNaN(n) && n >= 0 && n <= 1) out.threshold = n; }
	if (params.get('view') === 'archive') out.archiveView = true;
	const bug = params.get('bug'); if (bug) out.bugId = bug;
	return out;
}

export function serializeSonarUrlState(state: SonarUrlSnapshot): string {
	const p = new URLSearchParams();
	if (state.searchText.trim()) p.set('q', state.searchText.trim());
	if (state.sourceFilter) p.set('source', state.sourceFilter);
	if (state.areaFilter) p.set('area', state.areaFilter);
	if (state.severityFilter.size > 0) p.set('severity', setToCsv(state.severityFilter));
	if (state.statusFilter.size > 0) p.set('status', setToCsv(state.statusFilter));
	if (state.intakeTypeFilter.size > 0) p.set('type', setToCsv(state.intakeTypeFilter));
	if (state.reporterFilter.size > 0) p.set('reporter', setToCsv(state.reporterFilter));
	if (state.responderFilter.size > 0) p.set('tagged', setToCsv(state.responderFilter));
	if (state.assigneeFilter.size > 0) p.set('owner', setToCsv(state.assigneeFilter));
	if (state.useAi) p.set('ai', 'true');
	if (Math.abs(state.threshold - state.defaultThreshold) > 0.001) {
		p.set('threshold', state.threshold.toFixed(2));
	}
	if (state.archiveView) p.set('view', 'archive');
	return p.toString();
}

/**
 * Write the serialized state back to `window.location` without adding a
 * history entry. Uses replaceState so back-button still does what the
 * user expects (it returns to the previous app/page, not a half-built
 * filter state from one keystroke ago).
 */
export function writeSonarUrlToLocation(state: SonarUrlSnapshot): void {
	if (typeof window === 'undefined') return;
	const qs = serializeSonarUrlState(state);
	const url = new URL(window.location.href);
	url.search = qs;
	// Strip any leftover `?bug=` after the user has navigated past the
	// initial deep-link target. The bug param is read-only by design;
	// dropping it here keeps shared URLs minimal once you've moved on.
	url.searchParams.delete('bug');
	window.history.replaceState(window.history.state, '', url.toString());
}

/**
 * Convenience helper for the "Copy share link" button: returns the current
 * URL with the up-to-date query string already serialized. Useful when the
 * caller wants the link _now_, not at the next $effect tick.
 */
export function buildSonarShareUrl(state: SonarUrlSnapshot, bugId?: string | null): string {
	if (typeof window === 'undefined') return '';
	const url = new URL(window.location.href);
	url.search = serializeSonarUrlState(state);
	if (bugId) url.searchParams.set('bug', bugId);
	return url.toString();
}
