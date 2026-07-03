/**
 * Knowledge lookup for Slack questions.
 *
 * When someone @-mentions Sonar with a *question* (rather than a bug report),
 * we try to answer it by searching three knowledge sources:
 *
 *   1. Previous Slack conversations   — IMPLEMENTED (this file)
 *   2. Confluence docs                — NOT CONNECTED (stub; see searchConfluence)
 *   3. The codebase (via "ike")       — NOT CONNECTED (stub; see searchCodebase)
 *
 * The three searchers share one shape (`SourceResult`) so the Slack handler can
 * render them uniformly and so 2 & 3 can be filled in later without touching
 * callers. `lookupKnowledge` fans out to all three and returns them together.
 */
import type { Bug } from '$lib/schemas';
import { vectorizeQuery, similarityScore } from '$lib/cluster-text';
import { env } from '$env/dynamic/private';

export interface KnowledgeHit {
	title: string;
	snippet: string;
	url?: string;
	reporter?: string;
	/** 0–1 cosine similarity to the query. */
	similarity: number;
}

export interface SourceResult {
	/** Whether this source is wired up. false → we couldn't look here at all. */
	connected: boolean;
	hits: KnowledgeHit[];
	/** Human-readable status when there's nothing to show (or source is off). */
	note?: string;
}

export interface KnowledgeLookup {
	slack: SourceResult;
	confluence: SourceResult;
	codebase: SourceResult;
}

// Recall-oriented: lower than the dedupe threshold (0.4) because a loosely
// related past thread is still a useful pointer for a question.
const MIN_SIMILARITY = 0.12;
const MAX_HITS = 3;

/** One-line snippet: the first meaningful line of the ticket, capped. */
function snippet(bug: Bug, max = 180): string {
	const firstLine =
		(bug.description || '')
			.split('\n')
			.map((l) => l.trim())
			.find(Boolean) || bug.title;
	return firstLine.length > max ? firstLine.slice(0, max - 1) + '…' : firstLine;
}

/**
 * Source 1 — previous Slack conversations.
 *
 * The searchable corpus is every non-archived ticket that came from Slack (or
 * has accumulated Slack thread history): their `description` holds the original
 * message plus any threaded follow-ups, which is exactly the conversation text
 * we want to match a new question against. Ranked with the same TF-IDF cosine
 * the clusterer/dedupe use, so behavior is consistent across the app.
 */
export function searchSlackHistory(
	query: string,
	bugs: Bug[],
	opts: { excludeId?: string } = {}
): SourceResult {
	const q = query.trim();
	if (!q) return { connected: true, hits: [], note: 'Empty question.' };

	const corpus = bugs.filter(
		(b) =>
			b.archived !== true &&
			b._id !== opts.excludeId &&
			(b.source === 'slack' || (b.slackThreads?.length ?? 0) > 0)
	);
	if (corpus.length === 0) {
		return { connected: true, hits: [], note: 'No prior Slack conversations recorded yet.' };
	}

	const { corpusVecs, queryVec } = vectorizeQuery(q, corpus);
	const ranked = corpus
		.map((bug, i) => ({ bug, sim: similarityScore(corpusVecs[i], queryVec, 0) }))
		.filter((r) => r.sim >= MIN_SIMILARITY)
		.sort((a, b) => b.sim - a.sim)
		.slice(0, MAX_HITS);

	if (ranked.length === 0) {
		return { connected: true, hits: [], note: 'No similar past conversations found.' };
	}

	return {
		connected: true,
		hits: ranked.map(({ bug, sim }) => ({
			title: bug.title,
			snippet: snippet(bug),
			url: bug.slackThreads?.find((t) => t.permalink)?.permalink,
			reporter: bug.reporter,
			similarity: Math.round(sim * 1000) / 1000
		}))
	};
}

/**
 * Source 2 — Confluence docs. NOT CONNECTED.
 *
 * Wire up by setting CONFLUENCE_BASE_URL + CONFLUENCE_TOKEN and implementing a
 * CQL/search call here. Until then we report the source as unavailable so the
 * Slack reply can say so honestly rather than silently omitting it.
 */
export function searchConfluence(_query: string): SourceResult {
	const configured = Boolean(env.CONFLUENCE_BASE_URL && env.CONFLUENCE_TOKEN);
	return {
		connected: configured,
		hits: [],
		note: configured
			? 'Confluence search not yet implemented.'
			: 'Not connected yet.'
	};
}

/**
 * Source 3 — codebase search (via "ike"). NOT CONNECTED.
 *
 * Wire up by setting IKE_API_URL (+ token) and calling out to the code-search
 * service here. Reported as unavailable until then.
 */
export function searchCodebase(_query: string): SourceResult {
	const configured = Boolean(env.IKE_API_URL);
	return {
		connected: configured,
		hits: [],
		note: configured ? 'Codebase search not yet implemented.' : 'Not connected yet.'
	};
}

/** Fan out to all three sources for a single question. */
export function lookupKnowledge(
	query: string,
	bugs: Bug[],
	opts: { excludeId?: string } = {}
): KnowledgeLookup {
	return {
		slack: searchSlackHistory(query, bugs, opts),
		confluence: searchConfluence(query),
		codebase: searchCodebase(query)
	};
}
