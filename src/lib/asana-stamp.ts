/**
 * Shared Asana writeback helpers for Sonar.
 *
 * Two surfaces call into Asana today:
 *
 *   1. POST /api/asana — the "create Asana task" CTAs on cluster /
 *      bug-card buttons in the Sonar UI.
 *   2. POST /api/bugs/[id]/advance — the resolver workflow's
 *      pm-review -> ready-for-eng transition stamps a task at that
 *      moment, and the in-flight -> done transition closes it.
 *
 * Both stamp placeholder gid + URL fields onto the bug doc. There is no
 * real task-tracker integration in this build — the stamp is entirely
 * self-contained so the workflow can be exercised end-to-end.
 *
 * Kept as pure helpers (no auth, no zod parsing, no HTTP) so the two
 * call sites share one implementation and can't drift on what fields
 * get stamped or how a Bug's spec ends up as a task description.
 */
import { ASANA_PLACEHOLDER_BASE_URL } from './constants';
import type { Bug } from './schemas';

/** Fields the stamp writes back to the bug doc on creation. */
export interface AsanaStamp {
	asanaTaskGid: string;
	asanaTaskUrl: string;
	asanaPlaceholder: true;
}

/**
 * Generate a placeholder Asana writeback for `bug`. The `bug` argument
 * isn't strictly needed for the placeholder (the gid is random) — it's
 * threaded through so the swap-in for real Asana doesn't change the
 * call sites. When `asana-tasks` is ready this becomes:
 *
 *   const task = await asanaTasksClient.create({
 *     name: bug.title,
 *     notes: buildAsanaTaskDescription(bug),
 *     projects: [ASANA_PROJECT_GID],
 *     assignee: resolveAsanaUser(bug.assignee)
 *   });
 *   return { asanaTaskGid: task.gid, asanaTaskUrl: task.permalink_url };
 *
 * For now we just mint a gid and stamp the placeholder URL prefix.
 */
export function makeAsanaStampFor(_bug: Pick<Bug, '_id' | 'title' | 'specMarkdown' | 'areas' | 'assignee' | 'reviewer'>): AsanaStamp {
	const gid = `placeholder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	return {
		asanaTaskGid: gid,
		asanaTaskUrl: `${ASANA_PLACEHOLDER_BASE_URL}/${gid}`,
		asanaPlaceholder: true
	};
}

/**
 * Build the description blob that goes into the Asana task body. Plain
 * text today (Asana's API expects HTML for rich text — when the real
 * client lands we'll render markdown -> Asana-compatible HTML here).
 *
 * Lives here so the resolver page can preview "what eng will see in
 * Asana" without re-implementing the format. Today it's just the spec
 * markdown + a small footer linking back to Sonar.
 */
export function buildAsanaTaskDescription(
	bug: Pick<Bug, '_id' | 'title' | 'description' | 'specMarkdown' | 'areas' | 'reporter' | 'assignee' | 'reviewer'>
): string {
	const lines: string[] = [];
	lines.push(`Title: ${bug.title}`);
	if (bug.areas.length > 0) lines.push(`Areas: ${bug.areas.join(', ')}`);
	if (bug.reporter) lines.push(`Reporter: ${bug.reporter}`);
	if (bug.reviewer) lines.push(`Reviewer (PM): ${bug.reviewer}`);
	if (bug.assignee) lines.push(`Engineering owner: ${bug.assignee}`);
	lines.push('');
	lines.push('--- Spec ---');
	lines.push(bug.specMarkdown?.trim() || '_(no spec provided)_');
	lines.push('');
	lines.push('--- Original report ---');
	lines.push(bug.description);
	lines.push('');
	lines.push(`(Filed via Sonar — bugId: ${bug._id})`);
	return lines.join('\n');
}
