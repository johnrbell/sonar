import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { AUTH_COOKIE, SESSION_TOKEN, checkPassword } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = await request.json().catch(() => null);
	const password = body && typeof body.password === 'string' ? body.password : '';

	if (!checkPassword(password)) {
		return json({ error: 'Incorrect password.' }, { status: 401 });
	}

	cookies.set(AUTH_COOKIE, SESSION_TOKEN, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		maxAge: 60 * 60 * 24 * 30 // 30 days
	});

	return json({ ok: true });
};
