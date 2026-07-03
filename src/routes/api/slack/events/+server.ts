import { json, text } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	verifySlackSignature,
	usersInfo,
	getPermalink,
	postMessage,
	getBotUserId,
	addReaction
} from '$lib/server/slack';
import { getAllBugs, insertBug, updateMockBug } from '$lib/mocks';
import { vectorizeQuery, similarityScore } from '$lib/cluster';
import { lookupKnowledge, type KnowledgeLookup, type SourceResult } from '$lib/server/knowledge';
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
 *   - top-level message | app_mention that @-mentions Sonar:
 *       · a *question* → run a knowledge lookup (previous Slack convos +
 *         Confluence + codebase) and reply with what we found; also file it as
 *         a question ticket so the team can track the answer.
 *       · otherwise (bug/feature) → dedupe against existing bugs, then append
 *         the thread to the matched bug or file a new one (capturing file
 *         attachments), and reply prompting the reporter for more detail.
 *   - a reply inside a thread Sonar is already tracking → captured as extra
 *     context and appended to that ticket (no @-mention required).
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

	// A reply inside an existing thread: if it's a thread Sonar already tracks,
	// treat it as the reporter answering our "tell us more" prompt and attach
	// it to that ticket. No @-mention required for follow-ups.
	if (event.thread_ts && event.thread_ts !== event.ts) {
		await handleThreadReply(event);
		return;
	}

	// Sonar only files a ticket when it is explicitly @-mentioned — it never
	// files every channel message. Require the bot's own mention token.
	const rawText = event.text ?? '';
	const botUserId = await getBotUserId();
	if (!botUserId || !rawText.includes(`<@${botUserId}>`)) return;

	// Strip Sonar's own mention token so the ticket text reads cleanly.
	const messageText = stripMentions(rawText);
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

	// A question gets answered from the knowledge sources (and filed for
	// tracking) rather than run through bug dedupe.
	if (looksLikeQuestion(messageText)) {
		await handleQuestion(event, messageText, reporter, thread, attachments, allBugs);
		return;
	}

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
		text:
			`:satellite_antenna: Logged to Sonar as a new ticket: *${title}*.\n\n` +
			`To help us triage, reply in this thread with any details you have:\n` +
			`• *Steps to reproduce*\n` +
			`• *What you expected* vs. *what actually happened*\n` +
			`• *Affected area / feature*\n` +
			`• *Severity* (low / medium / high)\n\n` +
			`I'll attach your replies to this ticket automatically.`
	});
}

/**
 * Heuristic intake classifier: is this message a question (vs a bug/feature
 * report)? Deliberately simple + dependency-free — a trailing "?" or a leading
 * interrogative word. Good enough to route @-mentions; the corpus search does
 * the heavy lifting from there.
 */
function looksLikeQuestion(text: string): boolean {
	const t = text.trim().toLowerCase();
	if (!t) return false;
	if (t.includes('?')) return true;
	return /^(how|what|whats|why|when|where|who|which|can|could|would|should|does|do|did|is|are|will|has|have|any(one|body)?)\b/.test(
		t
	);
}

/**
 * Question flow: file the question as a ticket (so it's tracked + becomes part
 * of the searchable Slack history), run the knowledge lookup across all three
 * sources, and reply in-thread with what we found.
 */
async function handleQuestion(
	event: SlackMessageEvent,
	question: string,
	reporter: string,
	thread: SlackThread,
	attachments: SlackAttachment[],
	allBugs: Bug[]
): Promise<void> {
	const title = deriveTitle(question, []);
	const bug: Bug = {
		_id: crypto.randomUUID(),
		title,
		description: question,
		reporter,
		source: 'slack',
		severity: 'low',
		status: 'open',
		areas: [],
		intakeType: 'question',
		createdAt: thread.addedAt ?? new Date().toISOString(),
		slackThreads: [thread],
		...(attachments.length ? { attachments } : {})
	};
	await insertBug(bug);

	// Search the *prior* corpus (the new question isn't in allBugs yet).
	const knowledge = lookupKnowledge(question, allBugs, { excludeId: bug._id });

	await postMessage({
		channel: event.channel!,
		thread_ts: event.ts!,
		text: formatKnowledgeReply(knowledge)
	});
}

/** Render a knowledge lookup as a Slack mrkdwn reply. */
function formatKnowledgeReply(k: KnowledgeLookup): string {
	const lines: string[] = [":mag: Here's what I found for your question:", ''];

	lines.push('*Previous Slack conversations:*');
	lines.push(renderSource(k.slack));
	lines.push('');
	lines.push(`*Confluence docs:* ${k.confluence.connected ? '' : '_not connected yet_'}`);
	if (k.confluence.connected) lines.push(renderSource(k.confluence));
	lines.push(`*Codebase (ike):* ${k.codebase.connected ? '' : '_not connected yet_'}`);
	if (k.codebase.connected) lines.push(renderSource(k.codebase));
	lines.push('');
	lines.push("I've logged this as a question so the team can follow up.");
	return lines.join('\n');
}

function renderSource(s: SourceResult): string {
	if (s.hits.length === 0) return `  _${s.note ?? 'Nothing found.'}_`;
	return s.hits
		.map((h) => {
			const pct = Math.round(h.similarity * 100);
			const heading = h.url ? `<${h.url}|${h.title}>` : `*${h.title}*`;
			return `  • ${heading} — ${h.snippet} _(${pct}% match)_`;
		})
		.join('\n');
}

/**
 * A reply inside a thread Sonar is tracking → capture it as extra context on
 * the ticket. This is how the answers to the "tell us more" prompt get onto
 * the bug. Replies don't need to @-mention Sonar (that would be tedious); we
 * only act when the thread's root message is one we already filed.
 */
async function handleThreadReply(event: SlackMessageEvent): Promise<void> {
	const replyText = stripMentions(event.text ?? '');
	const files = event.files ?? [];
	if (!replyText && files.length === 0) return;

	const allBugs = await getAllBugs();
	const bug = allBugs.find((b) =>
		(b.slackThreads ?? []).some(
			(t) => t.channel === event.channel && t.ts === event.thread_ts
		)
	);
	if (!bug) return;

	// Idempotency: Slack retries events, so skip a reply ts we've already stored.
	const priorReplies = Array.isArray(bug.meta?.slackReplies)
		? (bug.meta!.slackReplies as SlackReply[])
		: [];
	if (priorReplies.some((r) => r.ts === event.ts)) return;

	const reporter = (await usersInfo(event.user!)).displayName;
	const entry: SlackReply = {
		ts: event.ts!,
		reporter,
		text: replyText,
		at: new Date().toISOString()
	};

	// Fold any newly-attached files onto the ticket too.
	const newAttachments: SlackAttachment[] = files.map((f) => ({
		id: f.id,
		...(f.name ? { name: f.name } : {}),
		...(f.mimetype ? { mimetype: f.mimetype } : {}),
		...(f.url_private ? { urlPrivate: f.url_private } : {}),
		...(f.permalink ? { permalink: f.permalink } : {}),
		isImage: Boolean(f.mimetype?.startsWith('image/'))
	}));

	// Surface the reply on the ticket body so it shows in the cluster panel,
	// and keep the structured log in meta for anything that wants it.
	const appended = replyText
		? `${bug.description}\n\n↪ ${reporter}: ${replyText}`
		: bug.description;

	await updateMockBug(bug._id, {
		description: appended,
		meta: { ...(bug.meta ?? {}), slackReplies: [...priorReplies, entry] },
		...(newAttachments.length
			? { attachments: [...(bug.attachments ?? []), ...newAttachments] }
			: {})
	});

	// Quietly confirm capture (best-effort — no-op without reactions:write).
	await addReaction(event.channel!, event.ts!, 'white_check_mark');
}

/** Strip Sonar's / any user mention tokens and collapse whitespace. */
function stripMentions(raw: string): string {
	return raw.replace(/<@[A-Z0-9]+>/g, '').replace(/\s+/g, ' ').trim();
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

// One captured follow-up reply, stored under bug.meta.slackReplies.
interface SlackReply {
	ts: string;
	reporter: string;
	text: string;
	at: string;
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
