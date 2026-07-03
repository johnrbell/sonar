import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuth } from '$lib/server/auth';
import { BugPatchSchema, type Bug } from '$lib/schemas';
import { updateMockBug, findMockBug, deleteMockBug } from '$lib/mocks';

// GET /api/bugs/[id] — single bug by id (used by the resolver page).
export const GET: RequestHandler = async ({ request, params }) => {
	await requireAuth(request);
	const id = params.id;
	if (!id) return json({ error: 'Missing bug id' }, { status: 400 });
	const hit = await findMockBug(id);
	if (!hit) return json({ error: 'Bug not found' }, { status: 404 });
	return json({ bug: hit });
};

/**
 * PATCH /api/bugs/[id] — partial update (severity / status / assignee /
 * reviewer / specMarkdown / archived / meta). Stage is intentionally NOT
 * patchable here — it goes through POST /api/bugs/[id]/advance which enforces
 * transition gates and writes an audit row to stageHistory.
 */
export const PATCH: RequestHandler = async ({ request, params }) => {
	await requireAuth(request);
	const id = params.id;
	if (!id) return json({ error: 'Missing bug id' }, { status: 400 });

	const raw = await request.json().catch(() => null);
	const parsed = BugPatchSchema.safeParse(raw);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
	}
	const { severity, status, assignee, reviewer, specMarkdown, archived, meta, setBy } = parsed.data;

	const update: Partial<Bug> = {};
	if (severity !== undefined) {
		update.severity = severity;
		if (setBy) update.severitySetBy = setBy;
		update.severitySetAt = new Date().toISOString();
	}
	if (status !== undefined) update.status = status;
	if (assignee !== undefined) update.assignee = assignee;
	if (reviewer !== undefined) update.reviewer = reviewer;
	if (specMarkdown !== undefined) update.specMarkdown = specMarkdown;
	if (archived !== undefined) update.archived = archived;

	const existing = await findMockBug(id);
	if (!existing) return json({ error: 'Bug not found' }, { status: 404 });
	const finalUpdate: Partial<Bug> = { ...update };
	if (meta !== undefined) {
		// Shallow-merge meta so individual fields can be edited without
		// clobbering the rest.
		finalUpdate.meta = { ...(existing.meta ?? {}), ...meta };
	}
	const updated = await updateMockBug(id, finalUpdate);
	return json({ ok: true, bug: updated });
};

/**
 * DELETE /api/bugs/[id]?confirm=true — remove a single bug. Requires
 * `?confirm=true` so a stray fetch can't wipe data. Seed bugs are tombstoned
 * for the process lifetime; runtime bugs are removed outright.
 */
export const DELETE: RequestHandler = async ({ request, params, url }) => {
	await requireAuth(request);
	const id = params.id;
	if (!id) return json({ error: 'Missing bug id' }, { status: 400 });

	if (url.searchParams.get('confirm') !== 'true') {
		return json({ error: 'Refusing destructive delete without ?confirm=true' }, { status: 400 });
	}

	const ok = await deleteMockBug(id);
	if (!ok) return json({ error: 'Bug not found' }, { status: 404 });
	return json({ ok: true });
};
