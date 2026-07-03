/**
 * One-off database seed / reset script.
 *
 * Usage (after `vercel env pull .env.development.local` so POSTGRES_URL is set):
 *   pnpm db:seed          # insert seed rows (idempotent, keeps existing data)
 *   pnpm db:seed -- --force  # TRUNCATE then re-seed to the clean starting data
 *
 * Runs standalone via tsx; it does not go through SvelteKit's `$env` module, so
 * POSTGRES_URL must be present in the process environment (pass it with
 * `--env-file=.env.development.local` — wired up in package.json).
 */
import { seedDatabase } from '../../mocks';

const force = process.argv.includes('--force');

seedDatabase(force)
	.then((count) => {
		console.log(`[sonar.db] seed complete${force ? ' (forced reset)' : ''} — ${count} bugs in table.`);
		process.exit(0);
	})
	.catch((err) => {
		console.error('[sonar.db] seed failed:', err);
		process.exit(1);
	});
