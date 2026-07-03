import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifySlackSignature, openView, postMessage } from '$lib/server/slack';
import { findMockBug, updateMockBug } from '$lib/mocks';
import { FEATURE_AREAS } from '$lib/constants';
import type { Bug, IntakeType, Severity } from '$lib/schemas';

/**
 * POST /api/slack/interactions — Slack interactive components webhook (PUBLIC).
 *
 * Exempt from the password gate (see hooks.server.ts) because Slack calls it
 * with no session cookie; security is HMAC signature verification instead.
 *
 * Handles two payload types from the "Add details" flow on a bug/feature
 * ticket:
 *   - block_actions (action_id `sonar_add_details`) → open the detail modal
 *     via views.open (needs the payload's single-use trigger_id).
 *   - view_submission (callback_id `sonar_bug_details`) → persist the
 *     structured fields onto the ticket and confirm in-thread.
 *
 * The request body is application/x-www-form-urlencoded with a single
 * `payload` field containing the JSON — NOT a JSON body like the Events API.
 */
export const POST: RequestHandler = async ({ request }) => {
	// Raw body is required for signature verification — read it once.
	const raw = await request.text();

	const sigOk = verifySlackSignature(
		raw,
		request.headers.get('x-slack-request-timestamp'),
		request.headers.get('x-slack-signature')
	);
	if (!sigOk) {
		return json({ error: 'invalid signature' }, { status: 401 });
	}

	const encoded = new URLSearchParams(raw).get('payload');
	if (!encoded) return json({ error: 'no payload' }, { status: 400 });

	let payload: SlackInteractionPayload;
	try {
		payload = JSON.parse(encoded) as SlackInteractionPayload;
	} catch {
		return json({ error: 'bad json' }, { status: 400 });
	}

	if (payload.type === 'block_actions') {
		// Open the modal inline (trigger_id is short-lived, ~3s). Ack with 200.
		try {
			await handleBlockActions(payload);
		} catch (err) {
			console.error('[sonar.slack] block_actions failed:', err);
		}
		return json({ ok: true });
	}

	if (payload.type === 'view_submission') {
		// Persist inline; an empty 200 body tells Slack to close the modal.
		try {
			await handleViewSubmission(payload);
		} catch (err) {
			console.error('[sonar.slack] view_submission failed:', err);
		}
		return json({});
	}

	return json({ ok: true });
};

/** A user clicked the "Add details" button — open the detail modal. */
async function handleBlockActions(payload: SlackInteractionPayload): Promise<void> {
	const action = payload.actions?.find((a) => a.action_id === 'sonar_add_details');
	if (!action?.value || !payload.trigger_id) return;

	const bug = await findMockBug(action.value);
	if (!bug) return;

	const channel = payload.channel?.id ?? '';
	// The ack message is itself a threaded reply, so its thread_ts is the
	// originating (root) message — reply there on submit.
	const threadTs = payload.message?.thread_ts ?? payload.message?.ts ?? '';

	const view = buildDetailModal(bug, { bugId: bug._id, channel, threadTs });
	await openView(payload.trigger_id, view);
}

/** Modal submitted — merge the structured fields onto the ticket + confirm. */
async function handleViewSubmission(payload: SlackInteractionPayload): Promise<void> {
	const view = payload.view;
	if (!view || view.callback_id !== 'sonar_bug_details') return;

	let ctx: ModalContext;
	try {
		ctx = JSON.parse(view.private_metadata ?? '{}') as ModalContext;
	} catch {
		return;
	}
	if (!ctx.bugId) return;

	const bug = await findMockBug(ctx.bugId);
	if (!bug) return;

	const values = view.state?.values ?? {};

	const patch: Partial<Bug> = {};

	// Severity (top-level).
	const severity = selectValue(values, 'severity');
	if (severity && isSeverity(severity)) patch.severity = severity;

	// Affected areas (top-level) — filter to the known set.
	const areas = multiSelectValues(values, 'areas').filter((a): a is (typeof FEATURE_AREAS)[number] =>
		(FEATURE_AREAS as readonly string[]).includes(a)
	);
	if (areas.length) patch.areas = areas;

	// Per-type meta fields. updateMockBug shallow-merges the top level, so we
	// merge meta ourselves to avoid clobbering existing keys.
	const metaPatch: Record<string, string> = {};
	for (const key of metaKeysFor(bug.intakeType)) {
		const v = textValue(values, key);
		if (v) metaPatch[key] = v;
	}
	if (Object.keys(metaPatch).length) {
		patch.meta = { ...(bug.meta ?? {}), ...metaPatch };
	}

	if (Object.keys(patch).length) {
		await updateMockBug(ctx.bugId, patch);
	}

	if (ctx.channel && ctx.threadTs) {
		await postMessage({
			channel: ctx.channel,
			thread_ts: ctx.threadTs,
			text: `:white_check_mark: Thanks — details added to *${bug.title}*.`
		});
	}
}

// --- Modal construction ---------------------------------------------------

interface ModalContext {
	bugId: string;
	channel: string;
	threadTs: string;
}

/** Meta field keys collected in the modal, keyed by intake type. */
function metaKeysFor(intakeType: IntakeType | undefined): string[] {
	if (intakeType === 'feature') return ['userPain', 'proposedApproach', 'urgency'];
	// Default to the bug field set (Slack files bug/question; question never
	// gets the button, so bug is the practical default here).
	return ['repro', 'expectedActual', 'device', 'browser', 'url'];
}

const SEVERITY_OPTIONS: { value: Severity; label: string }[] = [
	{ value: 'low', label: 'Low' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'high', label: 'High' }
];

function buildDetailModal(bug: Bug, ctx: ModalContext) {
	const blocks: unknown[] = [
		severityBlock(bug.severity),
		areasBlock(bug.areas ?? [])
	];

	if (bug.intakeType === 'feature') {
		blocks.push(
			textInputBlock('userPain', 'User pain', 'What problem does this solve?', true),
			textInputBlock('proposedApproach', 'Proposed approach', 'Optional', true),
			textInputBlock('urgency', 'Urgency / business value', '', false)
		);
	} else {
		blocks.push(
			textInputBlock('repro', 'Repro steps', '1. Open… 2. Click… 3. See…', true),
			textInputBlock('expectedActual', 'Expected vs. actual', '', true),
			textInputBlock('device', 'Device / OS', 'e.g. MacBook · macOS 14', false),
			textInputBlock('browser', 'Browser', 'e.g. Chrome 124', false),
			textInputBlock('url', 'URL where it happens', '', false)
		);
	}

	return {
		type: 'modal',
		callback_id: 'sonar_bug_details',
		private_metadata: JSON.stringify(ctx),
		title: { type: 'plain_text', text: 'Add details' },
		submit: { type: 'plain_text', text: 'Save' },
		close: { type: 'plain_text', text: 'Cancel' },
		blocks
	};
}

function severityBlock(current: Severity) {
	const initial = SEVERITY_OPTIONS.find((o) => o.value === current) ?? SEVERITY_OPTIONS[1];
	return {
		type: 'input',
		block_id: 'severity',
		optional: true,
		label: { type: 'plain_text', text: 'Severity' },
		element: {
			type: 'static_select',
			action_id: 'severity',
			initial_option: optionFor(initial.value, initial.label),
			options: SEVERITY_OPTIONS.map((o) => optionFor(o.value, o.label))
		}
	};
}

function areasBlock(current: string[]) {
	const initial = current
		.filter((a) => (FEATURE_AREAS as readonly string[]).includes(a))
		.map((a) => optionFor(a, a));
	return {
		type: 'input',
		block_id: 'areas',
		optional: true,
		label: { type: 'plain_text', text: 'Affected area(s)' },
		element: {
			type: 'multi_static_select',
			action_id: 'areas',
			...(initial.length ? { initial_options: initial } : {}),
			options: FEATURE_AREAS.map((a) => optionFor(a, a))
		}
	};
}

function textInputBlock(id: string, label: string, placeholder: string, multiline: boolean) {
	return {
		type: 'input',
		block_id: id,
		optional: true,
		label: { type: 'plain_text', text: label },
		element: {
			type: 'plain_text_input',
			action_id: id,
			multiline,
			...(placeholder
				? { placeholder: { type: 'plain_text', text: placeholder } }
				: {})
		}
	};
}

// Slack option text is capped at 75 chars.
function optionFor(value: string, label: string) {
	return {
		value,
		text: { type: 'plain_text', text: label.length > 75 ? label.slice(0, 72) + '…' : label }
	};
}

// --- state.values extraction ----------------------------------------------

function textValue(values: StateValues, block: string): string | undefined {
	const v = values[block]?.[block]?.value;
	return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function selectValue(values: StateValues, block: string): string | undefined {
	return values[block]?.[block]?.selected_option?.value;
}

function multiSelectValues(values: StateValues, block: string): string[] {
	return (values[block]?.[block]?.selected_options ?? []).map((o) => o.value);
}

function isSeverity(v: string): v is Severity {
	return v === 'low' || v === 'medium' || v === 'high';
}

// --- Slack interaction payload shapes (only the fields we read) ------------

interface SlackOption {
	value: string;
}

interface SlackStateValue {
	value?: string;
	selected_option?: SlackOption | null;
	selected_options?: SlackOption[];
}

type StateValues = Record<string, Record<string, SlackStateValue>>;

interface SlackView {
	callback_id?: string;
	private_metadata?: string;
	state?: { values?: StateValues };
}

interface SlackAction {
	action_id?: string;
	value?: string;
}

interface SlackInteractionPayload {
	type: string;
	trigger_id?: string;
	actions?: SlackAction[];
	channel?: { id?: string };
	message?: { ts?: string; thread_ts?: string };
	view?: SlackView;
}
