// Server-side clustering entrypoint. The pure pieces (tokenize, clusterLocal,
// vectorizeQuery, similarityScore, labelTokens, dedupeLabels) live in
// cluster-text.ts so they can also be imported by client code (BubbleViz,
// +page.svelte) for in-browser drill-down re-clustering without dragging in
// `$env/dynamic/private`.
//
// This module adds clusterWithAI on top of the deterministic baseline.

import { env } from '$env/dynamic/private';
import type { Bug, Cluster } from './schemas';
import { DEFAULT_CLUSTER_THRESHOLD, FEATURE_AREAS } from './constants';
import {
	clusterLocal,
	dedupeLabels,
	tokenize,
	vectorizeQuery,
	similarityScore,
	labelTokens
} from './cluster-text';

export { clusterLocal, tokenize, vectorizeQuery, similarityScore, labelTokens };

// Anthropic-powered clustering. Falls back to clusterLocal() on any failure.
export async function clusterWithAI(bugs: Bug[], threshold = DEFAULT_CLUSTER_THRESHOLD): Promise<Cluster[]> {
	if (!env.ANTHROPIC_API_KEY) return clusterLocal(bugs, threshold);
	if (bugs.length === 0) return [];

	const prompt = `You are clustering bug reports for an internal triage tool. Group bugs that describe the same underlying issue. Use the feature-area catalog below and the bug content.

Feature areas: ${FEATURE_AREAS.join(', ')}

Bugs (id · title · description · areas):
${bugs.map((b) => `${b._id} · ${b.title} · ${b.description} · [${b.areas.join(', ')}]`).join('\n')}

Return shape: [{ "id": "c0", "label": "short label", "primaryArea": "Dashboard", "areas": ["Dashboard"], "severity": "high|medium|low", "bugIds": ["b001", "b002"] }, ...]

Rules:
- Every bug id appears exactly once.
- A cluster with one bug is fine — only group bugs clearly about the same issue.
- "severity" is max across the cluster.
- "primaryArea" is the most common area; "areas" lists all areas in the cluster.
- "label" ≤ 48 chars.

Return ONLY valid JSON, no prose.`;

	try {
		const r = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'x-api-key': env.ANTHROPIC_API_KEY,
				'anthropic-version': '2023-06-01',
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				model: 'claude-sonnet-4-20250514',
				max_tokens: 4000,
				messages: [{ role: 'user', content: prompt }]
			})
		});
		if (!r.ok) {
			const upstreamBody = await r.text().catch(() => '<unreadable>');
			console.error('[sonar.cluster] Anthropic upstream', r.status, upstreamBody.slice(0, 500));
			throw new Error(`Anthropic ${r.status}`);
		}
		const data = await r.json();
		const text = data.content?.[0]?.text || '[]';
		const cleaned = text.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
		const clusters = JSON.parse(cleaned) as Cluster[];
		// Same de-dup pass as the local clusterer — the AI prompt asks for
		// short labels but doesn't guarantee uniqueness across clusters.
		return dedupeLabels(clusters.sort((a, b) => b.bugIds.length - a.bugIds.length));
	} catch (e) {
		console.error('[sonar.cluster] AI clustering failed, falling back to local:', e);
		return clusterLocal(bugs, threshold);
	}
}
