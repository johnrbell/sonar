import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuth } from '$lib/server/auth';
import { fetchSlackFile } from '$lib/server/slack';

/**
 * GET /api/slack/file?url=<slack url_private> — authenticated proxy for Slack
 * file attachments.
 *
 * Slack file URLs are private: downloading them requires the bot token in the
 * Authorization header, which must never reach the browser. This route (behind
 * the password gate, unlike /api/slack/events) streams the bytes server-side so
 * screenshots render inline in the Sonar UI.
 *
 * SSRF guard: only `files.slack.com` URLs are proxied, so the bot token is only
 * ever sent to Slack's own file host.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	await requireAuth(request);

	const target = url.searchParams.get('url');
	if (!target) return json({ error: 'Missing url' }, { status: 400 });

	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		return json({ error: 'Invalid url' }, { status: 400 });
	}
	if (parsed.protocol !== 'https:' || parsed.hostname !== 'files.slack.com') {
		return json({ error: 'Only files.slack.com URLs are allowed' }, { status: 400 });
	}

	const res = await fetchSlackFile(parsed.toString());
	if (!res.ok || !res.body) {
		return json({ error: 'Failed to fetch file' }, { status: 502 });
	}

	return new Response(res.body, {
		status: 200,
		headers: {
			'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
			'cache-control': 'private, max-age=300'
		}
	});
};
