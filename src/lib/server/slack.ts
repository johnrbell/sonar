/**
 * Minimal Slack Web API client + request-signature verification.
 *
 * Deliberately dependency-free: a thin `fetch` wrapper over the handful of
 * Web API methods Sonar needs (post messages, join channels, resolve
 * permalinks, look up users/files) plus HMAC verification of inbound Events
 * API requests. Credentials come from the environment:
 *
 *   SLACK_BOT_TOKEN      xoxb-... (Bot User OAuth Token)
 *   SLACK_SIGNING_SECRET used to verify that inbound requests are from Slack
 */
import crypto from 'node:crypto';
import { env } from '$env/dynamic/private';

const SLACK_API = 'https://slack.com/api';

export function getBotToken(): string | undefined {
	return env.SLACK_BOT_TOKEN;
}

export function getSigningSecret(): string | undefined {
	return env.SLACK_SIGNING_SECRET;
}

/** True when the bot token is present so outbound calls can be attempted. */
export function isSlackConfigured(): boolean {
	return Boolean(env.SLACK_BOT_TOKEN);
}

/**
 * Verify an inbound Slack request signature.
 *
 * Recomputes `v0=HMAC_SHA256(signing_secret, "v0:{ts}:{rawBody}")` and compares
 * it (constant-time) to the `x-slack-signature` header. Also rejects requests
 * whose timestamp is more than five minutes old to blunt replay attacks.
 *
 * `rawBody` MUST be the exact, unparsed request body.
 */
export function verifySlackSignature(
	rawBody: string,
	timestamp: string | null,
	signature: string | null
): boolean {
	const secret = getSigningSecret();
	if (!secret || !timestamp || !signature) return false;

	const ts = Number(timestamp);
	if (!Number.isFinite(ts)) return false;
	// Reject stale requests (> 5 minutes skew).
	if (Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false;

	const base = `v0:${timestamp}:${rawBody}`;
	const expected = 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');

	const a = Buffer.from(expected);
	const b = Buffer.from(signature);
	if (a.length !== b.length) return false;
	return crypto.timingSafeEqual(a, b);
}

interface SlackApiResult {
	ok: boolean;
	error?: string;
	[key: string]: unknown;
}

/**
 * Call a Slack Web API method with the bot token.
 *
 * Uses `application/x-www-form-urlencoded`, NOT JSON. This matters: Slack's
 * read/GET-style methods (users.info, chat.getPermalink, conversations.info)
 * do not parse arguments from a JSON body and fail with `user_not_found` /
 * `invalid_arguments`. Form-encoding is accepted by every method we use
 * (chat.postMessage, reactions.add, conversations.join included), so we encode
 * uniformly to avoid silent per-method breakage.
 */
async function callSlack(method: string, params: Record<string, unknown>): Promise<SlackApiResult> {
	const token = getBotToken();
	if (!token) return { ok: false, error: 'no_bot_token' };

	const form = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null) continue;
		form.set(key, typeof value === 'string' ? value : String(value));
	}

	const res = await fetch(`${SLACK_API}/${method}`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/x-www-form-urlencoded; charset=utf-8'
		},
		body: form.toString()
	});
	const data = (await res.json().catch(() => ({ ok: false, error: 'bad_json' }))) as SlackApiResult;
	if (!data.ok) {
		console.warn(`[sonar.slack] ${method} failed: ${data.error ?? 'unknown'}`);
	}
	return data;
}

/** Post a message. Pass `thread_ts` to reply in-thread. */
export async function postMessage(args: {
	channel: string;
	text: string;
	thread_ts?: string;
}): Promise<SlackApiResult> {
	return callSlack('chat.postMessage', {
		channel: args.channel,
		text: args.text,
		...(args.thread_ts ? { thread_ts: args.thread_ts } : {})
	});
}

/** Join a public channel so the bot receives its messages / can post to it. */
export async function joinConversation(channel: string): Promise<SlackApiResult> {
	return callSlack('conversations.join', { channel });
}

// Cache the bot's own user id (from auth.test) for the lifetime of the
// serverless instance — it never changes for a given token.
let _botUserId: string | null | undefined;

/**
 * The bot's own Slack user id (e.g. "U0123ABCD"), used to detect `@sonar`
 * mentions in inbound messages. Resolved once via `auth.test` and cached.
 * Returns `undefined` if the token is missing or the call fails.
 */
export async function getBotUserId(): Promise<string | undefined> {
	if (_botUserId !== undefined) return _botUserId ?? undefined;
	const res = await callSlack('auth.test', {});
	_botUserId = res.ok ? ((res.user_id as string | undefined) ?? null) : null;
	return _botUserId ?? undefined;
}

/** Resolve a permalink for a specific message timestamp. */
export async function getPermalink(channel: string, messageTs: string): Promise<string | undefined> {
	const res = await callSlack('chat.getPermalink', { channel, message_ts: messageTs });
	return res.ok ? (res.permalink as string | undefined) : undefined;
}

/**
 * Add an emoji reaction to a message (best-effort — used to silently confirm a
 * follow-up reply was captured onto a ticket). Requires the `reactions:write`
 * scope; if it's missing the call just warns and returns, so callers never
 * need to guard on it.
 */
export async function addReaction(channel: string, timestamp: string, name = 'white_check_mark'): Promise<void> {
	await callSlack('reactions.add', { channel, timestamp, name });
}

export interface SlackUserProfile {
	id: string;
	displayName: string;
}

/** Look up a user's display/real name. Falls back to the raw id on failure. */
export async function usersInfo(userId: string): Promise<SlackUserProfile> {
	const res = await callSlack('users.info', { user: userId });
	if (!res.ok) return { id: userId, displayName: userId };
	const user = res.user as
		| { real_name?: string; profile?: { display_name?: string; real_name?: string } }
		| undefined;
	const displayName =
		user?.profile?.display_name ||
		user?.profile?.real_name ||
		user?.real_name ||
		userId;
	return { id: userId, displayName };
}

/**
 * Fetch the raw bytes of a Slack file (requires `files:read`). Slack file URLs
 * are private and need the bot token in the Authorization header — used by the
 * /api/slack/file proxy so screenshots render in the Sonar UI.
 */
export async function fetchSlackFile(urlPrivate: string): Promise<Response> {
	const token = getBotToken();
	return fetch(urlPrivate, {
		headers: token ? { authorization: `Bearer ${token}` } : {}
	});
}
