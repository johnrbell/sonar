import { redirect, type Handle } from '@sveltejs/kit';
import { AUTH_COOKIE, isValidSession } from '$lib/server/auth';

/**
 * Password gate. Protected surfaces (the app pages + the data API) require a
 * valid session cookie; everything else — the login page, the login endpoint,
 * and static/build assets — is public so the login screen can render for a
 * signed-out visitor.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const authed = isValidSession(event.cookies.get(AUTH_COOKIE));
	event.locals.authed = authed;

	const path = event.url.pathname;
	const isProtectedPage = path === '/' || path.startsWith('/resolver');
	// Public APIs: the login endpoint and the Slack Events webhook. Slack calls
	// the events endpoint with no session cookie — it's secured by signing-secret
	// verification instead (see /api/slack/events). The Slack file proxy
	// (/api/slack/file) stays behind the gate so only signed-in users see files.
	const isPublicApi = path === '/api/login' || path === '/api/slack/events';
	const isProtectedApi = path.startsWith('/api/') && !isPublicApi;

	if (!authed && (isProtectedPage || isProtectedApi)) {
		if (isProtectedApi) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), {
				status: 401,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw redirect(303, '/login');
	}

	return resolve(event);
};
