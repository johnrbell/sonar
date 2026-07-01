/**
 * Sonar Ticket Resolver — state machine.
 *
 * Pure helpers, no imports from `$env` or `$lib/services` so the resolver
 * page (client-side Svelte) and the `/advance` endpoint (server-side) can
 * both import the SAME predicate and never disagree about whether a given
 * transition is legal. If they ever diverge users see a button that
 * 400s — and that's the bug category this module exists to prevent.
 *
 * The five stages a bug or feature ticket walks:
 *
 *   triage         → filed, awaiting assignee + reviewer
 *   pm-review      → reviewer is defining spec
 *   ready-for-eng  → spec done, Asana task exists, engineering can pick up
 *   in-flight      → engineering working (status='in-progress')
 *   done           → resolved (status='resolved', Asana closed, Slack followup fired)
 *
 * Backtracks are allowed but logged. Side effects on backward transitions
 * do NOT roll back (the Asana task lingers if you back out of
 * ready-for-eng — easier to fix forward than to undo).
 *
 * Question-type tickets never enter the resolver. `defaultStageFor()`
 * returns null for them so UI / API code can skip the whole flow.
 */
import type { Bug, Stage } from './schemas';

export const STAGE_ORDER: readonly Stage[] = [
	'triage',
	'pm-review',
	'ready-for-eng',
	'in-flight',
	'done'
] as const;

const STAGE_INDEX: Record<Stage, number> = {
	triage: 0,
	'pm-review': 1,
	'ready-for-eng': 2,
	'in-flight': 3,
	done: 4
};

export const STAGE_LABELS: Record<Stage, string> = {
	triage: 'Triage',
	'pm-review': 'PM review',
	'ready-for-eng': 'Ready for eng',
	'in-flight': 'In flight',
	done: 'Done'
};

/**
 * Stages that are "allowed targets" from a given current stage.
 *
 * Forward transitions: one step forward at a time. No skipping.
 * Backward transitions: exactly one step back (`pm-review -> triage`,
 *   `ready-for-eng -> pm-review`, `in-flight -> ready-for-eng`,
 *   `done -> in-flight`). Lets the team fix obvious oversights without
 *   unlocking arbitrary stage jumps.
 */
function allowedTargets(from: Stage): Stage[] {
	const i = STAGE_INDEX[from];
	const targets: Stage[] = [];
	const forward = STAGE_ORDER[i + 1];
	if (forward) targets.push(forward);
	const back = STAGE_ORDER[i - 1];
	if (back) targets.push(back);
	return targets;
}

export type TransitionResult = { ok: true } | { ok: false; reason: string };

/**
 * Single source of truth for "can this bug move from `from` to `to`?".
 * Used by both the API (to gate the transition) and the UI (to disable
 * the [Advance] button with the same explanation).
 *
 * `from` is passed explicitly (rather than read from bug.stage) so the
 * advance endpoint can detect mid-flight stage drift — if the client
 * thought the bug was in `triage` but a concurrent edit moved it to
 * `pm-review`, the API rejects rather than re-deriving and silently
 * advancing from the wrong base.
 */
export function canTransition(bug: Bug, from: Stage, to: Stage): TransitionResult {
	if (from === to) {
		return { ok: false, reason: 'Already at that stage.' };
	}
	const targets = allowedTargets(from);
	if (!targets.includes(to)) {
		const fromLabel = STAGE_LABELS[from];
		const toLabel = STAGE_LABELS[to];
		return {
			ok: false,
			reason: `Can't jump from ${fromLabel} to ${toLabel}. Move one step at a time.`
		};
	}

	// Forward-only gate checks. Backward transitions are unconditional;
	// the team is explicitly choosing to undo, so we don't second-guess.
	const forwardIdx = STAGE_INDEX[to] - STAGE_INDEX[from];
	if (forwardIdx < 0) return { ok: true };

	if (to === 'pm-review') {
		// Triage hand-off: someone needs to own the spec AND the eng work
		// before we hand it to PM. The reviewer field is the whole point
		// of this stage; the assignee gives the PM someone to call.
		if (!bug.assignee || bug.assignee.trim().length === 0) {
			return { ok: false, reason: 'Assign an engineering owner before moving to PM review.' };
		}
		if (!bug.reviewer || bug.reviewer.trim().length === 0) {
			return { ok: false, reason: 'Assign a PM / stakeholder reviewer before moving to PM review.' };
		}
		return { ok: true };
	}

	if (to === 'ready-for-eng') {
		// The spec IS the gate. We don't enforce a minimum length beyond
		// "not blank" — PMs are smart adults, the trade-off is faster
		// transitions vs. quality-gating spec content (which is a UX
		// decision, not a schema one).
		if (!bug.specMarkdown || bug.specMarkdown.trim().length === 0) {
			return { ok: false, reason: 'Fill in the spec before handing off to engineering.' };
		}
		return { ok: true };
	}

	// in-flight and done have no preconditions beyond "one step forward".
	// `in-flight` flips status to 'in-progress'; `done` flips to
	// 'resolved' and fires the side effects (Asana close + Slack
	// followup). Both side effects live in the advance endpoint —
	// keeping this module pure means it stays testable without HTTP.
	return { ok: true };
}

/**
 * Next forward stage from `from`, or null if `from` is the terminal
 * `done` stage. Used to render the "Advance to <next>" button label.
 */
export function nextForwardStage(from: Stage): Stage | null {
	const i = STAGE_INDEX[from];
	return STAGE_ORDER[i + 1] ?? null;
}

/**
 * Previous stage from `from`, or null if `from` is the initial `triage`
 * stage. Used to render the "Backtrack to <prev>" affordance.
 */
export function previousStage(from: Stage): Stage | null {
	const i = STAGE_INDEX[from];
	return STAGE_ORDER[i - 1] ?? null;
}

/**
 * Stage the resolver should treat this bug as being in for display
 * purposes. Returns:
 *   - null  → bug is a `question` (resolver doesn't apply; the resolver
 *             page 404s on these and the cluster-panel chip is hidden).
 *   - the bug's stored stage if set.
 *   - 'triage' otherwise (pre-resolver docs; effectively a lazy migration
 *     — the first transition stamps the field for real via the
 *     stageHistory entry).
 */
export function defaultStageFor(bug: Pick<Bug, 'stage' | 'intakeType'>): Stage | null {
	if (bug.intakeType === 'question') return null;
	return bug.stage ?? 'triage';
}

/**
 * Does this stage transition flip `status`?
 *   - ready-for-eng -> in-flight  : status -> 'in-progress'
 *   - in-flight     -> done       : status -> 'resolved'
 *   - done          -> in-flight  : status -> 'in-progress' (backtrack)
 *   - in-flight     -> ready-for-eng : status -> 'open'    (backtrack)
 *
 * Returned by `stageStatusFor()` so the advance endpoint can apply both
 * changes in a single write.
 */
export function stageStatusFor(to: Stage): 'open' | 'in-progress' | 'resolved' {
	if (to === 'done') return 'resolved';
	if (to === 'in-flight') return 'in-progress';
	// triage / pm-review / ready-for-eng all imply the ticket is still
	// open in the workflow sense, even if a previous backtrack moved
	// status off `open`. Backtracking from in-flight to ready-for-eng
	// resets status to open so the cluster viz stops showing it as
	// actively-worked.
	return 'open';
}
