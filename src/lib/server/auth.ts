/**
 * Simple shared-password gate.
 *
 * This standalone build has no external identity provider. Access is guarded
 * by a single shared password (default: "john", override with SONAR_PASSWORD).
 * A successful login sets an HttpOnly session cookie whose value must equal
 * SESSION_TOKEN; every protected page + API route checks for it.
 *
 * This is deliberately lightweight — it keeps casual/anonymous visitors out,
 * not determined attackers. Do not put anything sensitive behind it.
 */
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const AUTH_COOKIE = 'sonar_auth';

/** The shared password. Override in the environment for a real deploy. */
const PASSWORD = env.SONAR_PASSWORD ?? 'john';

/**
 * Opaque value stored in the session cookie. Not the password itself, so the
 * raw password never round-trips in a cookie. Override with SONAR_SESSION_SECRET
 * to invalidate all existing sessions.
 */
export const SESSION_TOKEN = env.SONAR_SESSION_SECRET ?? 'sonar-session-v1';

export function checkPassword(input: string): boolean {
	return input === PASSWORD;
}

export function isValidSession(cookieValue: string | undefined): boolean {
	return Boolean(cookieValue) && cookieValue === SESSION_TOKEN;
}

/** Read the session cookie straight off a raw Request's headers. */
function sessionCookieFromRequest(request: Request): string | undefined {
	const header = request.headers.get('cookie');
	if (!header) return undefined;
	for (const part of header.split(';')) {
		const [name, ...rest] = part.trim().split('=');
		if (name === AUTH_COOKIE) return decodeURIComponent(rest.join('='));
	}
	return undefined;
}

/**
 * Guard for API route handlers. Throws 401 unless the request carries a valid
 * session cookie. The `handle` hook already gates protected routes; this is
 * defense-in-depth so a handler is never reachable unauthenticated.
 */
export async function requireAuth(request: Request): Promise<void> {
	if (!isValidSession(sessionCookieFromRequest(request))) {
		throw error(401, 'Unauthorized');
	}
}

// Back-compat alias so route handlers can keep their original import name.
export const requireSonarAuth = requireAuth;
