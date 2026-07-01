// Sonar — feature areas bugs are tagged against. These are the product areas
// of a fictional SaaS collaboration app ("Nimbus"), used purely to give the
// demo realistic-looking clusters. Edit freely; the clustering + filtering all
// key off this list.
export const FEATURE_AREAS = [
	'Login / SSO',
	'Onboarding',
	'Dashboard',
	'Notifications',
	'Search',
	'File Upload',
	'Comments / Mentions',
	'Billing / Subscriptions',
	'Integrations',
	'Mobile App',
	'Performance',
	'Export / Import',
	'Permissions / Roles',
	'API / Webhooks',
	'Settings',
	'Email Delivery',
	'Calendar / Scheduling',
	'Reporting / Analytics',
	'Editor',
	'Deployment / CI'
] as const;

export type FeatureArea = (typeof FEATURE_AREAS)[number];

// Tuning knob for the clustering algorithm. Loose (0.20) groups generously;
// tight (0.45) only joins near-duplicates.
export const DEFAULT_CLUSTER_THRESHOLD = 0.3;

// Default threshold for /api/dedupe — tighter than clustering. A miss here
// just means a new bug gets filed; a false positive means a real new bug gets
// buried under an old one, which is the worse failure.
export const DEFAULT_DEDUPE_THRESHOLD = 0.4;

// Where the weekly digest + P0 channel pings would go. Cosmetic in this build
// (there's no live Slack integration) — surfaced in the sidebar as a reminder.
export const DIGEST_SLACK_CHANNEL = '#bug-tracker';

// Placeholder task-tracker URL prefix. The "Create task" CTAs stamp a synthetic
// gid + URL onto the bug doc so the workflow can be exercised end-to-end without
// a real integration.
export const ASANA_PLACEHOLDER_BASE_URL = 'https://app.asana.com/0/PLACEHOLDER';

/**
 * Normalize a single area string. Kept as an identity-with-fallback so the rest
 * of the app only ever sees current area names. (In this build there are no
 * legacy renames; the hook stays so old data would still map cleanly.)
 */
export function normalizeArea(area: string): FeatureArea {
	return area as FeatureArea;
}

/**
 * Read-boundary helper: returns a shallow clone of `bug` with `areas` mapped
 * through `normalizeArea`. Used everywhere bugs are loaded from the seed/store.
 */
export function normalizeBugAreas<T extends { areas: string[] }>(bug: T): T {
	return { ...bug, areas: bug.areas.map(normalizeArea) } as T;
}
