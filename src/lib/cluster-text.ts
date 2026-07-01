// Pure text-cosine clustering. No env / $env imports — safe to import on the
// client (BubbleViz, +page.svelte) for in-browser drill-down re-clustering.
//
// The full clusterWithAI() path lives in cluster.ts which imports this file
// for clusterLocal and adds the Anthropic call on top.

import type { Bug, Cluster, Severity } from './schemas';
import { DEFAULT_CLUSTER_THRESHOLD } from './constants';

const STOP = new Set([
	'a','an','and','the','is','it','in','on','at','to','for','of','with','by','this','that','are','was','were','be','been','have','has','had','do','does','did','will','would','should','could','i','me','my','we','our','you','your','they','them','their','there','here','when','where','why','how','what','which','who','whom','as','or','but','if','then','so','than','just','now','also','about','into','from','up','down','out','over','under','again','still','too','very','one','two','three','seems','got','get','gets','im','its','like','need','needs','not','no','yes','some','any','all','more','most','much','many','lot','lots','via','per','etc'
]);

export function tokenize(text: string): string[] {
	return (text || '')
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((w) => w.length > 2 && !STOP.has(w));
}

function tfidf(docs: Bug[]): Record<string, number>[] {
	const tokenized = docs.map((d) => tokenize(d.title + ' ' + d.description));
	const df: Record<string, number> = {};
	tokenized.forEach((toks) => new Set(toks).forEach((t) => { df[t] = (df[t] || 0) + 1; }));
	const N = docs.length;
	const idf: Record<string, number> = {};
	Object.keys(df).forEach((t) => { idf[t] = Math.log((N + 1) / (df[t] + 1)) + 1; });
	return tokenized.map((toks) => {
		const tf: Record<string, number> = {};
		toks.forEach((t) => { tf[t] = (tf[t] || 0) + 1; });
		const vec: Record<string, number> = {};
		let norm = 0;
		Object.keys(tf).forEach((t) => {
			const v = (tf[t] / toks.length) * idf[t];
			vec[t] = v;
			norm += v * v;
		});
		norm = Math.sqrt(norm) || 1;
		Object.keys(vec).forEach((t) => { vec[t] /= norm; });
		return vec;
	});
}

function cosine(a: Record<string, number>, b: Record<string, number>): number {
	let sum = 0;
	const small = Object.keys(a).length < Object.keys(b).length ? a : b;
	const big = small === a ? b : a;
	for (const k in small) if (big[k]) sum += small[k] * big[k];
	return sum;
}

// Project arbitrary text onto the same TF-IDF space as the existing corpus.
// Returns the corpus vectors + the query vector so /api/dedupe can rank
// candidates against the live bug set using the same math the clustering uses.
export function vectorizeQuery(
	query: string,
	corpus: Bug[]
): { corpusVecs: Record<string, number>[]; queryVec: Record<string, number> } {
	const fauxQueryBug: Bug = {
		_id: '__query__',
		title: query,
		description: '',
		reporter: '',
		source: 'api',
		severity: 'low',
		status: 'open',
		areas: [],
		createdAt: new Date().toISOString(),
		slackThreads: []
	};
	const allVecs = tfidf([...corpus, fauxQueryBug]);
	return {
		corpusVecs: allVecs.slice(0, corpus.length),
		queryVec: allVecs[allVecs.length - 1]
	};
}

export function similarityScore(
	a: Record<string, number>,
	b: Record<string, number>,
	sharedAreas = 0
): number {
	let s = cosine(a, b);
	if (sharedAreas > 0) s = Math.min(1.0, s + 0.18 * sharedAreas);
	return s;
}

/**
 * Deterministic clustering. The optional `excludeTokens` set is used during
 * drill-down: when re-clustering inside a parent cluster, the parent's label
 * tokens are excluded from the keyword pool so child labels surface what's
 * NEW at this level instead of repeating the parent's discriminator.
 */
export function clusterLocal(
	bugs: Bug[],
	threshold = DEFAULT_CLUSTER_THRESHOLD,
	excludeTokens: Set<string> = new Set()
): Cluster[] {
	if (bugs.length === 0) return [];
	const vecs = tfidf(bugs);
	const N = bugs.length;
	const parent = bugs.map((_, i) => i);
	const find = (x: number): number => {
		while (parent[x] !== x) {
			parent[x] = parent[parent[x]];
			x = parent[x];
		}
		return x;
	};
	const union = (a: number, b: number) => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent[ra] = rb;
	};
	const pairs: [number, number, number][] = [];
	for (let i = 0; i < N; i++) {
		for (let j = i + 1; j < N; j++) {
			let s = cosine(vecs[i], vecs[j]);
			const aset = new Set(bugs[i].areas);
			const shared = bugs[j].areas.filter((x) => aset.has(x)).length;
			if (shared > 0) s = Math.min(1.0, s + 0.18 * shared);
			if (s >= threshold) pairs.push([s, i, j]);
		}
	}
	pairs.sort((a, b) => b[0] - a[0]);
	pairs.forEach(([, i, j]) => union(i, j));

	const groups: Record<number, Bug[]> = {};
	bugs.forEach((b, i) => {
		const r = find(i);
		(groups[r] = groups[r] || []).push(b);
	});

	return dedupeLabels(Object.values(groups)
		.map((group, idx): Cluster => {
			const areaCounts: Record<string, number> = {};
			group.flatMap((b) => b.areas).forEach((a) => { areaCounts[a] = (areaCounts[a] || 0) + 1; });
			const sortedAreas = Object.entries(areaCounts)
				.sort((a, b) => b[1] - a[1])
				.map((e) => e[0]);
			const tokenCounts: Record<string, number> = {};
			group.forEach((b) => tokenize(b.title).forEach((t) => {
				if (excludeTokens.has(t)) return;
				tokenCounts[t] = (tokenCounts[t] || 0) + 1;
			}));
			// Always suffix the top title-token (was: required ≥2 occurrences).
			// The old threshold left many small clusters labeled with bare
			// primaryArea ("Dashboard", "Dashboard", "Dashboard" — no
			// way to tell them apart on the radar). Even a single-occurrence
			// keyword is more discriminating than nothing.
			const keyword = Object.entries(tokenCounts).sort((a, b) => b[1] - a[1])[0];
			const label = group.length === 1
				? group[0].title
				: (sortedAreas[0] || 'Misc') + (keyword ? ` · ${keyword[0]}` : '');
			const severity: Severity = group.some((b) => b.severity === 'high')
				? 'high'
				: group.some((b) => b.severity === 'medium')
					? 'medium'
					: 'low';
			return {
				id: `c${idx}`,
				label: label.length > 48 ? label.slice(0, 45) + '...' : label,
				primaryArea: sortedAreas[0] || 'Misc',
				areas: sortedAreas,
				severity,
				bugIds: group.map((b) => b._id)
			};
		})
		.sort((a, b) => b.bugIds.length - a.bugIds.length));
}

/**
 * Final-pass label de-duplication. After both local and AI clustering some
 * clusters can still end up with identical labels — same primaryArea, same
 * top keyword, or two AI-generated phrases that just happened to collide.
 * On the radar these look like noise ("which Dashboard bubble is which?").
 *
 * Strategy: largest cluster in each collision group keeps the original
 * label; smaller ones get a discriminator suffix — first the second-most-
 * common area, then a `(N bugs)` count as a last resort. Labels stay
 * capped at 60 chars.
 */
export function dedupeLabels(clusters: Cluster[]): Cluster[] {
	const byLabel = new Map<string, Cluster[]>();
	for (const c of clusters) {
		const k = c.label;
		if (!byLabel.has(k)) byLabel.set(k, []);
		byLabel.get(k)!.push(c);
	}
	for (const group of byLabel.values()) {
		if (group.length < 2) continue;
		group.sort((a, b) => b.bugIds.length - a.bugIds.length);
		for (let i = 1; i < group.length; i++) {
			const c = group[i];
			const altArea = c.areas.find((a) => a !== c.primaryArea);
			const suffix = altArea ? ` · ${altArea}` : ` (${c.bugIds.length} bugs)`;
			const next = `${c.label}${suffix}`;
			c.label = next.length > 60 ? next.slice(0, 57) + '…' : next;
		}
	}
	return clusters;
}

/**
 * Tokens already represented in a cluster's label. Used as `excludeTokens`
 * when re-clustering inside a drill, so child labels surface words NEW at
 * this level instead of repeating the parent's discriminator. Strips the
 * `·` separator the labels use and lowercases each remaining word.
 */
export function labelTokens(c: { label: string }): Set<string> {
	return new Set(
		(c.label || '')
			.split(' · ')
			.flatMap((p) => p.split(/\s+/))
			.map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ''))
			.filter((t) => t.length > 2 && !STOP.has(t))
	);
}
