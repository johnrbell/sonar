import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({ runtime: 'nodejs22.x' }),
		// Slack posts interactivity payloads (the "Add details" button, modal
		// submits) as application/x-www-form-urlencoded with no matching Origin
		// header. SvelteKit's default CSRF origin check treats that as a
		// cross-site form POST and 403s it ("Cross-site POST form submissions
		// are forbidden") before the route handler runs — which breaks
		// /api/slack/interactions while /api/slack/events (JSON) is unaffected.
		// The Slack webhooks are secured by HMAC signature verification instead
		// (see server/slack.ts), and every other route is behind the session
		// cookie, so the origin check is redundant here.
		csrf: { checkOrigin: false }
	}
};

export default config;
