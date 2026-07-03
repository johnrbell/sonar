import { json, text } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifySlackSignature, usersInfo, getPermalink, postMessage, getBotUserId } from '$lib/server/slack';
import { getAllBugs, insertBug, updateMockBug } from '$lib/mocks';
import { vectorizeQuery, similarityScore } from '$lib/cluster';
import { DEFAULT_DEDUPE_THRESHOLD } from '$lib/constants';
import type { Bug, SlackThread, SlackAttachment } from '$lib/schemas';

/**
 * POST /api/slack/events — Slack Events API webhook (PUBLIC route).
 *
 * This endpoint is intentionally exempt from the password gate (see
 * hooks.server.ts) because Slack's servers call it without a session cookie.
 * Security comes from HMAC signature verification instead: every request is
 * checked against SLACK_SIGNING_SECRET before we act on it.
 *
 * Flow:
 *   - url_verification → echo the challenge (Slack's setup handshake)
 *   - event_callback / message | app_mention → only when the Sonar bot is
 *     explicitly @-mentioned: dedupe against existing bugs, then either append
 *     the thread to the matched bug or file a new one, capturing any file
 *     attachments, and post a threaded acknowledgement back to Slack.
 */
export const POST: RequestHandler = async ({ request }) => {
	// The raw body is required for signature verification — read it once.
	const raw = await request.text();

	const sigOk = verifySlackSignature(
		raw,
		request.headers.get('x-slack-request-timestamp'),
		request.headers.get('x-slack-signature')
	);
	if (!sigOk) {
		return json({ error: 'invalid signature' }, { status: 401 });
	}

	let payload: SlackEnvelope;
	try {
		payload = JSON.parse(raw) as SlackEnvelope;
	} catch {
		return json({ error: 'bad json' }, { status: 400 });
	}

	// Setup handshake — echo the challenge back verbatim.
	if (payload.type === 'url_verification') {
		return text(payload.challenge ?? '');
	}

	if (payload.type === 'event_callback' && payload.event) {
		// Acknowledge fast; do the work inline (single workspace, low volume).
		// Errors are logged, never surfaced to Slack (which would just retry).
		try {
			await handleEvent(payload.event);
		} catch (err) {
			console.error('[sonar.slack] event handling failed:', err);
		}
	}

	// Always 200 so Slack doesn't retry a successfully-received event.
	return json({ ok: true });
};

async function handleEvent(event: SlackMessageEvent): Promise<void> {
	if (event.type !== 'message' && event.type !== 'app_mention') return;
	// Ignore bot messages, our own echoes, and edit/delete/join noise. Keep the
	// `file_share` subtype (a user uploading a file with a comment).
	if (event.bot_id) return;
	if (event.subtype && event.subtype !== 'file_share') return;
	if (!event.user || !event.channel || !event.ts) return;
	// Only ingest top-level messages, not thread replies.
	if (event.thread_ts && event.thread_ts !== event.ts) return;

	// Sonar only acts when it is explicitly @-mentioned — it never files every
	// channel message. Require the bot's own mention token in the text.
	const rawText = event.text ?? '';
	const botUserId = await getBotUserId();
	if (!botUserId || !rawText.includes(`<@${botUserId}>`)) return;

	// Strip Sonar's own mention token so the ticket text reads cleanly.
	const messageText = rawText
		.replace(new RegExp(`<@${botUserId}>`, 'g'), '')
		.replace(/\s+/g, ' ')
		.trim();
	const files = event.files ?? [];
	if (!messageText && files.length === 0) return;

	// Idempotency: Slack retries on slow responses. If we've already recorded a
	// thread for this exact channel+ts, do nothing (prevents duplicate bugs).
	const allBugs = await getAllBugs();
	const already = allBugs.some((b) =>
		(b.slackThreads ?? []).some((t) => t.channel === event.channel && t.ts === event.ts)
	);
	if (already) return;

	const reporter = (await usersInfo(event.user)).displayName;
	const permalink = await getPermalink(event.channel, event.ts);
	const now = new Date().toISOString();

	const thread: SlackThread = {
		channel: event.channel,
		ts: event.ts,
		...(permalink ? { permalink } : {}),
		reporter,
		addedAt: now
	};

	const attachments: SlackAttachment[] = files.map((f) => ({
		id: f.id,
		...(f.name ? { name: f.name } : {}),
		...(f.mimetype ? { mimetype: f.mimetype } : {}),
		...(f.url_private ? { urlPrivate: f.url_private } : {}),
		...(f.permalink ? { permalink: f.permalink } : {}),
		isImage: Boolean(f.mimetype?.startsWith('image/'))
	}));

	// Dedupe against existing (non-archived) bug-type tickets.
	const match = findDuplicate(messageText || (files[0]?.name ?? ''), allBugs);

	if (match) {
		// Same issue as an existing open/in-progress ticket — append this thread.
		const threads = [...(match.slackThreads ?? []), thread];
		const mergedAttachments = [...(match.attachments ?? []), ...attachments];
		await updateMockBug(match._id, {
			slackThreads: threads,
			...(mergedAttachments.length ? { attachments: mergedAttachments } : {})
		});
		await postMessage({
			channel: event.channel,
			thread_ts: event.ts,
			text: `:mag: Linked to an existing Sonar ticket: *${match.title}*. Tracking this thread as another report.`
		});
		return;
	}

	// New ticket.
	const title = deriveTitle(messageText, files);
	const bug: Bug = {
		_id: crypto.randomUUID(),
		title,
		description: messageText || `File upload: ${files.map((f) => f.name).filter(Boolean).join(', ')}`,
		reporter,
		source: 'slack',
		severity: 'medium',
		status: 'open',
		areas: [],
		intakeType: 'bug',
		createdAt: now,
		slackThreads: [thread],
		...(attachments.length ? { attachments } : {})
	};
	await insertBug(bug);

	await postMessage({
		channel: event.channel,
		thread_ts: event.ts,
		text: `:satellite_antenna: Logged to Sonar as a new ticket: *${title}*.`
	});
}

/** Rank the query against existing open/in-progress bugs; return the best match above threshold. */
function findDuplicate(query: string, allBugs: Bug[]): Bug | null {
	const q = query.trim();
	if (!q) return null;
	const corpus = allBugs.filter(
		(b) => b.archived !== true && (b.intakeType ?? 'bug') === 'bug'
	);
	if (corpus.length === 0) return null;

	const { corpusVecs, queryVec } = vectorizeQuery(q, corpus);
	let best: Bug | null = null;
	let bestSim = 0;
	corpus.forEach((bug, i) => {
		const sim = similarityScore(corpusVecs[i], queryVec, 0);
		if (sim > bestSim) {
			bestSim = sim;
			best = bug;
		}
	});

	if (!best || bestSim < DEFAULT_DEDUPE_THRESHOLD) return null;
	// Resolved tickets don't absorb new reports — a recurrence should file fresh.
	const status = (best as Bug).status ?? 'open';
	if (status === 'resolved') return null;
	return best;
}

/** First non-empty line of the message, truncated; falls back to a file name. */
function deriveTitle(messageText: string, files: SlackFile[]): string {
	const firstLine = messageText.split('\n').map((l) => l.trim()).find(Boolean);
	const base = firstLine || files.map((f) => f.name).filter(Boolean)[0] || 'Slack report';
	return base.length > 120 ? base.slice(0, 117) + '...' : base;
}

// --- Slack event payload shapes (only the fields we read) ---
interface SlackEnvelope {
	type: string;
	challenge?: string;
	event?: SlackMessageEvent;
}

interface SlackFile {
	id: string;
	name?: string;
	mimetype?: string;
	url_private?: string;
	permalink?: string;
}

interface SlackMessageEvent {
	type: string;
	subtype?: string;
	bot_id?: string;
	user?: string;
	channel?: string;
	ts?: string;
	thread_ts?: string;
	text?: string;
	files?: SlackFile[];
}
