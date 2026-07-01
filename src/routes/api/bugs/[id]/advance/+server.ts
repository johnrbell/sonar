import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuth } from '$lib/server/auth';
import {
	AdvanceStageRequestSchema,
	type Bug,
	type Stage,
	type StageHistoryEntry
} from '$lib/schemas';
import { findMockBug, updateMockBug } from '$lib/mocks';
import { canTransition, defaultStageFor, stageStatusFor } from '$lib/stages';
import { makeAsanaStampFor } from '$lib/asana-stamp';

/**
 * POST /api/bugs/[id]/advance — transition a bug through the Ticket Resolver
 * state machine with validation, audit, and side effects.
 *
 * Side effects are self-contained in this build: the pm-review → ready-for-eng
 * transition stamps a placeholder task (gid + url) on the bug; the
 * in-flight → done transition stamps `asanaClosedAt`. There is no external
 * Slack/Asana call — the "resolved followup" is reported as a local no-op so
 * the resolver UI shows a consistent summary.
 *
 * Body: { to: Stage, by: string, note?: string }
 */
export const POST: RequestHandler = async ({ request, params }) => {
	await requireAuth(request);

	const id = params.id;
	if (!id) return json({ error: 'Missing bug id' }, { status: 400 });

	const raw = await request.json().catch(() => null);
	const parsed = AdvanceStageRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
	}
	const { to, by, note } = parsed.data;

	const existing = findMockBug(id);
	if (!existing) return json({ error: 'Bug not found' }, { status: 404 });

	// Questions don't enter the resolver.
	const from = defaultStageFor(existing);
	if (from === null) {
		return json(
			{ error: 'This ticket is a question — the resolver workflow does not apply.' },
			{ status: 422 }
		);
	}

	// Gate check — same predicate the resolver page uses to enable/disable the
	// Advance button.
	const result = canTransition(existing, from, to);
	if (!result.ok) {
		return json({ error: result.reason }, { status: 400 });
	}

	const historyEntry: StageHistoryEntry = {
		from,
		to,
		by,
		at: new Date().toISOString(),
		...(note ? { note } : {})
	};

	const sideEffectUpdates: Partial<Bug> = {};
	const sideEffectReport: SideEffectReport = {};

	// pm-review → ready-for-eng : create placeholder task
	if (from === 'pm-review' && to === 'ready-for-eng') {
		if (!existing.asanaTaskGid) {
			const stamp = makeAsanaStampFor(existing);
			sideEffectUpdates.asanaTaskGid = stamp.asanaTaskGid;
			sideEffectUpdates.asanaTaskUrl = stamp.asanaTaskUrl;
			sideEffectUpdates.asanaPlaceholder = stamp.asanaPlaceholder;
			sideEffectReport.asanaCreated = {
				gid: stamp.asanaTaskGid,
				url: stamp.asanaTaskUrl,
				placeholder: true
			};
		} else {
			sideEffectReport.asanaCreated = {
				gid: existing.asanaTaskGid,
				url: existing.asanaTaskUrl ?? '',
				placeholder: Boolean(existing.asanaPlaceholder),
				reused: true
			};
		}
	}

	// in-flight → done : close the placeholder task. The originating-thread
	// followup is a no-op in this build (no live Slack integration); we report
	// it as skipped so the UI summary stays informative.
	if (from === 'in-flight' && to === 'done') {
		if (!existing.asanaClosedAt) {
			sideEffectUpdates.asanaClosedAt = new Date().toISOString();
			const threadCount = existing.slackThreads?.length ?? 0;
			sideEffectReport.slackFollowup =
				threadCount > 0
					? { skipped: 'no-live-slack-integration' }
					: { threadsAttempted: 0, threadsPosted: 0 };
		} else {
			sideEffectReport.slackFollowup = { skipped: 'already-resolved' };
		}
	}

	const updated = applyAdvanceWrite(id, { to, historyEntry, sideEffectUpdates });
	if (!updated) {
		return json({ error: 'Bug vanished mid-write' }, { status: 404 });
	}

	console.log(`[sonar.advance] ${id} ${from} -> ${to} by ${by}`);
	return json({ ok: true, bug: updated, sideEffects: sideEffectReport });
};

interface SideEffectReport {
	asanaCreated?: {
		gid?: string;
		url?: string;
		placeholder?: boolean;
		reused?: boolean;
		error?: string;
	};
	slackFollowup?: {
		threadsAttempted?: number;
		threadsPosted?: number;
		skipped?: string;
		error?: string;
	};
}

interface WriteArgs {
	to: Stage;
	historyEntry: StageHistoryEntry;
	sideEffectUpdates: Partial<Bug>;
}

function applyAdvanceWrite(id: string, args: WriteArgs): Bug | null {
	const newStatus = stageStatusFor(args.to);
	const existing = findMockBug(id);
	if (!existing) return null;
	const nextHistory = [...(existing.stageHistory ?? []), args.historyEntry];
	return updateMockBug(id, {
		stage: args.to,
		status: newStatus,
		...args.sideEffectUpdates,
		stageHistory: nextHistory
	});
}
