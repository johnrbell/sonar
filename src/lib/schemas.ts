import { z } from 'zod/v4';
import { FEATURE_AREAS } from './constants';

export const SeveritySchema = z.enum(['low', 'medium', 'high']);
export type Severity = z.infer<typeof SeveritySchema>;

export const StatusSchema = z.enum(['open', 'in-progress', 'resolved']);
export type Status = z.infer<typeof StatusSchema>;

export const SourceSchema = z.enum(['internal', 'public', 'platform-modal', 'api', 'slack']);
export type Source = z.infer<typeof SourceSchema>;

// Intake type — drives the type-specific fields in the in-app LogBugModal.
// "bug" is the default for back-compat with anything that predates the modal.
export const IntakeTypeSchema = z.enum(['bug', 'feature', 'question']);
export type IntakeType = z.infer<typeof IntakeTypeSchema>;

// Resolver-workflow position — parallel to (not replacing) `status`. Bugs
// and feature requests walk this state machine; questions do not (they
// get answered or filed-as-question and never enter the resolver). The
// canonical transition rules live in `stages.ts`; this enum is the
// shape every other surface (UI, API, audit log) reads.
//
// Default for legacy / pre-resolver docs is 'triage' (computed on read
// via stages.ts:defaultStageFor — we do NOT migrate existing docs).
export const StageSchema = z.enum([
	'triage',         // filed, awaiting an assignee + reviewer
	'pm-review',      // PM/stakeholder defining spec
	'ready-for-eng',  // spec done, Asana task created, eng can pick up
	'in-flight',      // eng is working (paired with status='in-progress')
	'done'            // resolved (paired with status='resolved')
]);
export type Stage = z.infer<typeof StageSchema>;

// One row in a bug's stage transition audit log. Appended atomically by
// POST /api/bugs/[id]/advance every time the stage moves (forward
// or backward), so the resolver page can render a complete history of
// who-did-what-when.
export const StageHistoryEntrySchema = z.object({
	// `null` only on the very first transition out of "no stage was set"
	// (i.e. a legacy doc being touched for the first time).
	from: StageSchema.nullable(),
	to: StageSchema,
	by: z.string().max(100),
	at: z.string(),
	note: z.string().max(500).optional()
});
export type StageHistoryEntry = z.infer<typeof StageHistoryEntrySchema>;

// Slack-thread provenance. Attached when a bug is filed from a thread, and
// appended to an existing bug when /api/dedupe returns a confident match.
// (Cosmetic in this build — there is no live Slack integration.)
export const SlackThreadSchema = z.object({
	channel: z.string().min(1).max(100),
	ts: z.string().min(1).max(50),
	permalink: z.string().url().optional(),
	reporter: z.string().max(100).optional(),
	addedAt: z.string().optional()
});
export type SlackThread = z.infer<typeof SlackThreadSchema>;

// Public intake shape — what the in-app "Log a bug" modal POSTs.
export const BugIntakeSchema = z.object({
	title: z.string().min(3).max(200),
	description: z.string().min(3).max(5000),
	reporter: z.string().max(100).optional(),
	source: SourceSchema.optional().default('api'),
	severity: SeveritySchema.optional().default('medium'),
	areas: z.array(z.enum(FEATURE_AREAS)).optional().default([]),
	// Bug / feature / question. Drives which follow-up modal opens in Slack
	// and how the ticket gets tagged in the panel. Defaults to "bug" so
	// older callers keep working.
	intakeType: IntakeTypeSchema.optional().default('bug'),
	// Suggested triage owner. Optional — manual intake won't always know it.
	assignee: z.string().max(100).optional(),
	// Folks tagged on the originating thread, for context in the cluster panel.
	responders: z.array(z.string()).optional(),
	// Optional Slack provenance — when a bug is filed from a thread.
	slackThread: SlackThreadSchema.optional(),
	// Free-form metadata from the caller. The intake modal writes per-type keys
	// here: bug → device, browser, url, repro, expectedActual; feature →
	// userPain, proposedApproach, urgency; question → audience, context.
	meta: z.record(z.string(), z.unknown()).optional()
});
export type BugIntake = z.infer<typeof BugIntakeSchema>;

// What we store + return.
export const BugSchema = z.object({
	_id: z.string(),
	title: z.string(),
	description: z.string(),
	reporter: z.string(),
	source: SourceSchema,
	severity: SeveritySchema,
	// When severity is changed after intake, we record who and when so the UI
	// can show "Severity: high (set by <name>, 2026-05-21)".
	severitySetBy: z.string().max(100).optional(),
	severitySetAt: z.string().optional(),
	status: StatusSchema.optional().default('open'),
	areas: z.array(z.enum(FEATURE_AREAS)),
	intakeType: IntakeTypeSchema.optional(),
	assignee: z.string().optional(),
	responders: z.array(z.string()).optional(),
	createdAt: z.string(),
	// All Slack threads where this bug was reported. Starts with the originating
	// thread (if any) and grows via POST /api/bugs/[id]/sources when
	// /api/dedupe routes a new thread to an existing bug.
	slackThreads: z.array(SlackThreadSchema).optional().default([]),
	asanaTaskGid: z.string().optional(),
	asanaTaskUrl: z.string().optional(),
	asanaPlaceholder: z.boolean().optional(),
	// Stamped when the resolver advances stage `in-flight -> done`. In this
	// build it's just a timestamp (there is no live task tracker) so the
	// idempotency guard knows the "close" side effect has already fired.
	asanaClosedAt: z.string().optional(),
	// --- Resolver workflow (see stages.ts) ---
	// Current position in the resolver state machine. Unset on docs that
	// predate the resolver; the UI + APIs treat unset as 'triage' on read.
	stage: StageSchema.optional(),
	// PM / stakeholder who owns the spec for this ticket. Distinct from
	// `assignee` (engineering owner). Free-form display name in v1; can
	// become a per-area lookup later.
	reviewer: z.string().max(100).optional(),
	// Free-form markdown the PM/stakeholder fills out during the
	// pm-review stage. Becomes the Asana task description on the
	// pm-review -> ready-for-eng transition.
	specMarkdown: z.string().max(20000).optional(),
	// Append-only stage transition audit log. In practice each bug walks
	// ~5–10 transitions across its lifetime so we don't bother capping.
	stageHistory: z.array(StageHistoryEntrySchema).optional(),
	// Soft-archive flag. Orthogonal to `status` so unarchiving restores
	// the bug to its original workflow state. Archived bugs are excluded
	// from active clustering and pooled into the Archive overlay.
	archived: z.boolean().optional(),
	meta: z.record(z.string(), z.unknown()).optional()
});
export type Bug = z.infer<typeof BugSchema>;

// Partial update over an existing bug. Severity is the only field exposed
// today (driven by the Slack-button override); status + assignee are wired
// up so the same endpoint covers the obvious next moves without a follow-up
// PR. Any field not present is left untouched.
export const BugPatchSchema = z.object({
	severity: SeveritySchema.optional(),
	status: StatusSchema.optional(),
	assignee: z.string().max(100).optional(),
	// PM / stakeholder owner of the spec. Set from the resolver page's
	// reviewer picker. `stage` is intentionally NOT patchable here — it
	// goes through POST /api/bugs/[id]/advance which enforces
	// transition gates + audit-logs the move.
	reviewer: z.string().max(100).optional(),
	// Spec markdown drafted during pm-review. Free-text edit, no merge —
	// the field is single-author by design for v1.
	specMarkdown: z.string().max(20000).optional(),
	// Soft-archive toggle — drag a bug card onto the Archive pool to set
	// true; "Unarchive" button in the archive viewer sets false.
	archived: z.boolean().optional(),
	// Partial meta merge — the Slack follow-up modal submits the per-type
	// fields here; the PATCH route reads the existing bug's meta and
	// shallow-merges in this object so individual fields can be edited
	// without clobbering the rest.
	meta: z.record(z.string(), z.unknown()).optional(),
	// Who initiated the change (for audit trail in the UI). When the Slack
	// interactions endpoint calls this, it's the Slack user's display name.
	setBy: z.string().max(100).optional()
}).refine(
	(d) =>
		d.severity !== undefined ||
		d.status !== undefined ||
		d.assignee !== undefined ||
		d.reviewer !== undefined ||
		d.specMarkdown !== undefined ||
		d.archived !== undefined ||
		d.meta !== undefined,
	{ message: 'Provide at least one of `severity`, `status`, `assignee`, `reviewer`, `specMarkdown`, `archived`, or `meta`.' }
);
export type BugPatch = z.infer<typeof BugPatchSchema>;

// POST /api/bugs/[id]/advance — explicit stage transition with
// validation + audit. Stage changes have side effects (Asana create on
// pm-review -> ready-for-eng; Asana close + Slack followup on
// in-flight -> done) so they don't belong on the generic PATCH path.
export const AdvanceStageRequestSchema = z.object({
	to: StageSchema,
	by: z.string().min(1).max(100),
	note: z.string().max(500).optional()
});
export type AdvanceStageRequest = z.infer<typeof AdvanceStageRequestSchema>;

export const ClusterSchema = z.object({
	id: z.string(),
	label: z.string(),
	primaryArea: z.string(),
	areas: z.array(z.string()),
	severity: SeveritySchema,
	bugIds: z.array(z.string())
});
export type Cluster = z.infer<typeof ClusterSchema>;

// /api/dedupe input — raw text in (PRE-classification), matches out.
export const DedupeRequestSchema = z.object({
	// Either pass `text` (raw Slack thread content) or structured title/description.
	text: z.string().max(8000).optional(),
	title: z.string().max(300).optional(),
	description: z.string().max(8000).optional(),
	areas: z.array(z.enum(FEATURE_AREAS)).optional().default([]),
	limit: z.number().int().min(1).max(20).optional().default(5),
	threshold: z.number().min(0).max(1).optional(),
	// Scope the dedupe corpus to bugs of the same intake type. The Slack
	// handler classifies first and passes this through, so questions only
	// match questions, bugs only bugs, etc. Cross-type collisions on
	// shared vocabulary ("access", "team", "export") are exactly the
	// false-positive class this fixes. Omitted = "search across all types".
	intakeType: IntakeTypeSchema.optional()
}).refine(
	(d) => Boolean(d.text || d.title || d.description),
	{ message: 'Provide `text`, or `title`/`description`.' }
);
export type DedupeRequest = z.infer<typeof DedupeRequestSchema>;

export const DedupeMatchSchema = z.object({
	bugId: z.string(),
	title: z.string(),
	similarity: z.number(),
	severity: SeveritySchema,
	// Lifecycle status of the matched bug. The Slack handler branches on
	// this: open / in-progress matches get the new thread appended (today's
	// behavior); resolved matches file a new bug + surface the prior
	// resolution in the reply so the user can collapse-as-duplicate if it
	// really is the same regression. Legacy docs without a `status` field
	// are coerced to 'open' by the dedupe endpoint so they behave the same
	// as the dominant historical case.
	status: StatusSchema,
	areas: z.array(z.string()),
	slackThreadCount: z.number(),
	asanaTaskGid: z.string().optional(),
	asanaTaskUrl: z.string().optional()
});
export type DedupeMatch = z.infer<typeof DedupeMatchSchema>;

// /api/asana placeholder writeback.
export const AsanaWriteRequestSchema = z.object({
	bugId: z.string().optional(),
	clusterId: z.string().optional(),
	confirm: z.literal(true)
}).refine(
	(d) => Boolean(d.bugId || d.clusterId),
	{ message: 'Provide `bugId` or `clusterId`.' }
);
export type AsanaWriteRequest = z.infer<typeof AsanaWriteRequestSchema>;

// Appending a new Slack-thread source to an existing bug (dedupe-hit path).
export const AppendSourceRequestSchema = z.object({
	slackThread: SlackThreadSchema
});
export type AppendSourceRequest = z.infer<typeof AppendSourceRequestSchema>;
