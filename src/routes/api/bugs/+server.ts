import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuth } from '$lib/server/auth';
import { BugIntakeSchema, type Bug } from '$lib/schemas';
import { getMockBugs, getRuntimeBugs, addRuntimeBug } from '$lib/mocks';

// GET /api/bugs — list bugs (newest first).
export const GET: RequestHandler = async ({ request }) => {
	await requireAuth(request);
	return json({ bugs: [...getRuntimeBugs(), ...getMockBugs()] });
};

// POST /api/bugs — file a new bug/feature/question. Validated with zod.
export const POST: RequestHandler = async ({ request }) => {
	await requireAuth(request);
	const raw = await request.json().catch(() => null);
	const parsed = BugIntakeSchema.safeParse(raw);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
	}
	const intake = parsed.data;
	const now = new Date().toISOString();
	const initialThreads = intake.slackThread
		? [{ ...intake.slackThread, addedAt: intake.slackThread.addedAt ?? now }]
		: [];
	const bug: Bug = {
		_id: crypto.randomUUID(),
		title: intake.title,
		description: intake.description,
		reporter: intake.reporter || 'Anonymous',
		source: intake.source,
		severity: intake.severity,
		status: 'open',
		areas: intake.areas,
		intakeType: intake.intakeType,
		...(intake.assignee ? { assignee: intake.assignee } : {}),
		...(intake.responders && intake.responders.length > 0
			? { responders: intake.responders }
			: {}),
		createdAt: now,
		slackThreads: initialThreads,
		meta: intake.meta
	};
	addRuntimeBug(bug);
	return json({ ok: true, bug });
};
