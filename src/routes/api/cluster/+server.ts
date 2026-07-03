import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuth } from '$lib/server/auth';
import { clusterLocal, clusterWithAI } from '$lib/cluster';
import { getAllBugs } from '$lib/mocks';
import { DEFAULT_CLUSTER_THRESHOLD } from '$lib/constants';
import { env } from '$env/dynamic/private';
import type { Bug } from '$lib/schemas';

export const GET: RequestHandler = async ({ request, url }) => {
	await requireAuth(request);
	const threshold = parseFloat(url.searchParams.get('threshold') || `${DEFAULT_CLUSTER_THRESHOLD}`);
	const useAi = url.searchParams.get('ai') === 'true' && !!env.ANTHROPIC_API_KEY;

	const allBugs: Bug[] = await getAllBugs();

	// Soft-archived bugs are pooled into a separate list and excluded from
	// clustering. The client renders them inside the Archive overlay (a
	// pinned grayscale bubble) and lets the user un-archive via PATCH.
	const bugs = allBugs.filter((b) => !b.archived);
	const archivedBugs = allBugs.filter((b) => b.archived === true);

	const clusters = useAi
		? await clusterWithAI(bugs, threshold)
		: clusterLocal(bugs, threshold);

	return json(
		{ clusters, bugs, archivedBugs, threshold, mode: useAi ? 'ai' : 'local' },
		{ headers: { 'cache-control': 'private, max-age=10' } }
	);
};
