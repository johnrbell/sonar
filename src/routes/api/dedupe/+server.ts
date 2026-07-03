import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuth } from '$lib/server/auth';
import { DedupeRequestSchema, type DedupeMatch, type Bug } from '$lib/schemas';
import { vectorizeQuery, similarityScore } from '$lib/cluster';
import { DEFAULT_DEDUPE_THRESHOLD } from '$lib/constants';
import { getAllBugs } from '$lib/mocks';

/**
 * POST /api/dedupe — "is this new?" Takes raw text (or a structured
 * title/description) and returns ranked matches against existing bugs above the
 * similarity threshold. Uses the same TF-IDF math as the clusterer.
 */
export const POST: RequestHandler = async ({ request }) => {
	await requireAuth(request);

	const raw = await request.json().catch(() => null);
	const parsed = DedupeRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
	}
	const req = parsed.data;
	const threshold = req.threshold ?? DEFAULT_DEDUPE_THRESHOLD;

	const query = [req.title, req.description, req.text].filter(Boolean).join(' ').trim();
	if (!query) {
		return json({ matches: [], threshold, mode: 'empty-query' as const });
	}

	let corpus: Bug[] = await getAllBugs();

	// Archived bugs should never absorb new reports — filter them out.
	corpus = corpus.filter((b) => b.archived !== true);

	// Intake-type scoping: questions only dedupe against questions, etc.
	if (req.intakeType) {
		corpus = corpus.filter((b) => (b.intakeType ?? 'bug') === req.intakeType);
	}

	if (corpus.length === 0) {
		return json({ matches: [], threshold, corpusSize: 0, mode: 'cold-start' as const });
	}

	const { corpusVecs, queryVec } = vectorizeQuery(query, corpus);
	const inputAreas = new Set(req.areas);
	const scored = corpus.map((bug, i) => {
		const sharedAreas = bug.areas.filter((a) => inputAreas.has(a)).length;
		const sim = similarityScore(corpusVecs[i], queryVec, sharedAreas);
		return { bug, sim };
	});

	const matches: DedupeMatch[] = scored
		.filter((s) => s.sim >= threshold)
		.sort((a, b) => b.sim - a.sim)
		.slice(0, req.limit)
		.map(({ bug, sim }) => ({
			bugId: bug._id,
			title: bug.title,
			similarity: Math.round(sim * 1000) / 1000,
			severity: bug.severity,
			status: bug.status ?? 'open',
			areas: bug.areas,
			slackThreadCount: bug.slackThreads?.length ?? 0,
			...(bug.asanaTaskGid ? { asanaTaskGid: bug.asanaTaskGid } : {}),
			...(bug.asanaTaskUrl ? { asanaTaskUrl: bug.asanaTaskUrl } : {})
		}));

	return json({
		matches,
		threshold,
		corpusSize: corpus.length,
		mode: matches.length > 0 ? ('hit' as const) : ('miss' as const)
	});
};
