/**
 * Ticket Resolver page — load function.
 *
 * Root +layout.ts already sets `ssr = false` so this runs in the
 * browser. The actual bug load happens in +page.svelte's onMount (the
 * session cookie rides along automatically on the same-origin fetch).
 *
 * The "404 on question-type" rule is enforced in the advance endpoint
 * + surfaced as inline error UI on the page when the bug loads.
 */
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	return { bugId: params.id };
};
