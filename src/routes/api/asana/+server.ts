import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuth } from '$lib/server/auth';
import { AsanaWriteRequestSchema } from '$lib/schemas';
import { updateMockBug, findMockBug, getAllBugs } from '$lib/mocks';
import { makeAsanaStampFor, buildAsanaTaskDescription } from '$lib/asana-stamp';

/**
 * POST /api/asana — placeholder task-tracker writeback.
 *
 * Stamps a synthetic gid + URL onto a bug and returns the task description that
 * a real integration would send. There is no external call; this is the
 * self-contained stand-in for a task-tracker (Asana/Jira/etc.) integration so
 * the workflow can be exercised end-to-end.
 *
 * `confirm: true` required (mutates bug docs).
 */
export const POST: RequestHandler = async ({ request }) => {
	await requireAuth(request);

	const raw = await request.json().catch(() => null);
	const parsed = AsanaWriteRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
	}
	const { bugId, clusterId } = parsed.data;

	if (clusterId && !bugId) {
		return json(
			{ error: 'clusterId not supported — POST one bugId at a time so each task carries its own spec.' },
			{ status: 400 }
		);
	}
	if (!bugId) {
		return json({ error: 'Provide bugId.' }, { status: 400 });
	}

	const existing = await findMockBug(bugId);
	if (!existing) return json({ error: 'Bug not found' }, { status: 404 });
	if (existing.asanaTaskGid) {
		// Already stamped — return existing without re-minting so the gid stays
		// stable across UI re-clicks.
		return json({
			ok: true,
			stamped: [existing],
			placeholder: Boolean(existing.asanaPlaceholder),
			reused: true,
			taskDescription: buildAsanaTaskDescription(existing),
			corpusSize: (await getAllBugs()).length
		});
	}
	const stamp = makeAsanaStampFor(existing);
	const updated = await updateMockBug(bugId, {
		asanaTaskGid: stamp.asanaTaskGid,
		asanaTaskUrl: stamp.asanaTaskUrl,
		asanaPlaceholder: stamp.asanaPlaceholder
	});
	return json({
		ok: true,
		stamped: updated ? [updated] : [],
		placeholder: true,
		taskDescription: updated ? buildAsanaTaskDescription(updated) : undefined,
		corpusSize: (await getAllBugs()).length
	});
};
