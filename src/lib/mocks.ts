// Data store. Originally an in-memory store seeded from a synthetic JSON file;
// now backed by Vercel Postgres so writes survive across serverless
// invocations (required for the Slack integration, whose events land in a
// different function instance than the web UI reads from).
//
// Each bug is stored as a single JSONB document keyed by its `_id`. The seed
// JSON is loaded once on first access if the table is empty. The public API is
// intentionally the same shape the rest of the app already imported, only now
// async.
import { createPool, type VercelPool } from '@vercel/postgres';
import type { Bug } from './schemas';
import { normalizeBugAreas } from './constants';
import seedBugs from './seed-bugs.json';

type BugRow = { doc: Bug };

// Lazily-created connection pool. We read the connection string explicitly (with
// fallbacks) rather than relying on @vercel/postgres's default POSTGRES_URL
// lookup: Vercel Postgres is now backed by Neon, whose integration may expose
// the string as DATABASE_URL. Reading process.env directly (instead of
// SvelteKit's $env) also lets the standalone `db:seed` tsx script reuse this
// module.
let _pool: VercelPool | null = null;

function pool(): VercelPool {
	if (!_pool) {
		const connectionString =
			process.env.POSTGRES_URL ||
			process.env.DATABASE_URL ||
			process.env.POSTGRES_PRISMA_URL ||
			process.env.POSTGRES_URL_NON_POOLING;
		_pool = createPool(connectionString ? { connectionString } : undefined);
	}
	return _pool;
}

// One-time (per process) schema + seed guard. Every query awaits this so the
// table exists before the first read/write. `CREATE TABLE IF NOT EXISTS` is
// idempotent, and seeding uses ON CONFLICT DO NOTHING so concurrent cold
// starts can't produce duplicates.
let readyPromise: Promise<void> | null = null;

function ensureReady(): Promise<void> {
	if (!readyPromise) {
		readyPromise = init().catch((err) => {
			// Reset so a transient failure (e.g. DB waking up) can retry on the
			// next call instead of caching a rejected promise forever.
			readyPromise = null;
			throw err;
		});
	}
	return readyPromise;
}

async function init(): Promise<void> {
	await pool().sql`
		CREATE TABLE IF NOT EXISTS bugs (
			id TEXT PRIMARY KEY,
			doc JSONB NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`;
	const { rows } = await pool().sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM bugs`;
	if (rows[0]?.n === 0) {
		await insertSeed();
	}
}

async function insertSeed(): Promise<void> {
	for (const bug of seedBugs as Bug[]) {
		await pool().sql`
			INSERT INTO bugs (id, doc, created_at)
			VALUES (${bug._id}, ${JSON.stringify(bug)}::jsonb, ${bug.createdAt})
			ON CONFLICT (id) DO NOTHING
		`;
	}
}

/**
 * Re-seed the database. Used by the `db:seed` script. When `force` is true the
 * table is truncated first (a clean reset to the synthetic starting data).
 */
export async function seedDatabase(force = false): Promise<number> {
	await ensureReady();
	if (force) {
		await pool().sql`TRUNCATE TABLE bugs`;
	}
	await insertSeed();
	const { rows } = await pool().sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM bugs`;
	return rows[0]?.n ?? 0;
}

/** All bugs, newest first, areas normalized. */
export async function getAllBugs(): Promise<Bug[]> {
	await ensureReady();
	const { rows } = await pool().sql<BugRow>`SELECT doc FROM bugs ORDER BY created_at DESC`;
	return rows.map((r) => normalizeBugAreas(r.doc));
}

export async function findMockBug(id: string): Promise<Bug | null> {
	await ensureReady();
	const { rows } = await pool().sql<BugRow>`SELECT doc FROM bugs WHERE id = ${id}`;
	const doc = rows[0]?.doc;
	return doc ? normalizeBugAreas(doc) : null;
}

/** Insert a brand-new bug. */
export async function insertBug(bug: Bug): Promise<Bug> {
	await ensureReady();
	await pool().sql`
		INSERT INTO bugs (id, doc, created_at)
		VALUES (${bug._id}, ${JSON.stringify(bug)}::jsonb, ${bug.createdAt})
		ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc
	`;
	return normalizeBugAreas(bug);
}

/**
 * Shallow-merge `patch` into an existing bug's document. Returns the updated
 * bug, or null if the id doesn't exist.
 */
export async function updateMockBug(id: string, patch: Partial<Bug>): Promise<Bug | null> {
	await ensureReady();
	const { rows } = await pool().sql<BugRow>`SELECT doc FROM bugs WHERE id = ${id}`;
	const existing = rows[0]?.doc;
	if (!existing) return null;
	const merged: Bug = { ...existing, ...patch };
	await pool().sql`UPDATE bugs SET doc = ${JSON.stringify(merged)}::jsonb WHERE id = ${id}`;
	return normalizeBugAreas(merged);
}

export async function deleteMockBug(id: string): Promise<boolean> {
	await ensureReady();
	const { rowCount } = await pool().sql`DELETE FROM bugs WHERE id = ${id}`;
	return (rowCount ?? 0) > 0;
}
