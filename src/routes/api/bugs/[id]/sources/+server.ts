import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuth } from '$lib/server/auth';
import { AppendSourceRequestSchema, type SlackThread } from '$lib/schemas';
import { updateMockBug, findMockBug } from '$lib/mocks';

/**
 * POST /api/bugs/[id]/sources — append a report-source (Slack thread) to an
 * existing bug. Used when a new report is judged to be the same issue as an
 * existing one, so it's tracked on that bug instead of filed as a duplicate.
 */
export const POST: RequestHandler = async ({ request, params }) => {
	await requireAuth(request);

	const id = params.id;
	if (!id) return json({ error: 'Missing bug id' }, { status: 400 });

	const raw = await request.json().catch(() => null);
	const parsed = AppendSourceRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
	}

	const newThread: SlackThread = {
		...parsed.data.slackThread,
		addedAt: parsed.data.slackThread.addedAt ?? new Date().toISOString()
	};

	const existing = findMockBug(id);
	if (!existing) return json({ error: 'Bug not found' }, { status: 404 });
	const threads = [...(existing.slackThreads ?? []), newThread];
	const updated = updateMockBug(id, { slackThreads: threads });
	return json({ ok: true, bug: updated });
};
