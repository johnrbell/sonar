# Sonar (standalone)

Sonar is a **bug & feedback radar** with AI-assisted clustering and a
ticket-resolver workflow. This is a self-contained, standalone build: it runs on
**synthetic data**, has **no external service integrations**, and is protected by
a single shared password.

It's a demo/prototype — everything resets when the process restarts.

## What it does

- **Radar** — a force-directed bubble visualization (d3) of incoming bug reports,
  grouped into clusters of related issues.
- **Clustering** — bugs are grouped by textual similarity (TF-IDF). Optionally,
  if you supply your own `ANTHROPIC_API_KEY`, an AI clustering mode is available;
  otherwise it always uses the local algorithm.
- **Dedupe** — a "is this new?" similarity check against existing bugs.
- **Ticket Resolver** — a per-ticket state machine (triage → pm-review →
  ready-for-eng → in-flight → done) with an assignee/reviewer, a spec editor, an
  audit log, and self-contained placeholder side effects.

## Data & persistence

Bugs are persisted in **Vercel Postgres**. Each bug is stored as a single JSONB
document keyed by `_id`. On first access the store creates the table and, if
empty, seeds it from [`seed-bugs.json`](./seed-bugs.json) — ~40 fictional bugs
for a made-up SaaS app ("Nimbus").

The store lives in [`mocks.ts`](./mocks.ts) (all async): `getAllBugs`,
`findMockBug`, `insertBug`, `updateMockBug`, `deleteMockBug`, plus
`seedDatabase()` used by the `pnpm db:seed` script
([`server/db/seed.ts`](./server/db/seed.ts)).

Locally, run `vercel env pull .env.development.local` to fetch `POSTGRES_URL`,
then `pnpm db:seed` (add `-- --force` to reset to the clean seed data).

To regenerate or edit the seed set, edit `seed-bugs.json` directly (it's a plain
array of `Bug` objects — see the `BugSchema` in [`schemas.ts`](./schemas.ts)).

## Integrations

**Slack** is a live integration; **Asana** is still a self-contained placeholder.

- **Slack** — a real bot (see [`server/slack.ts`](./server/slack.ts)):
  - Inbound: messages in channels the bot is in hit
    [`/api/slack/events`](../routes/api/slack/events/+server.ts) (a public,
    signing-secret-verified webhook). Each message is deduped against existing
    bugs and either appended to a match or filed as a new `source: 'slack'` bug,
    capturing file attachments.
  - Outbound: the resolver's `in-flight → done` transition posts a resolution
    follow-up back to every originating thread via `chat.postMessage`.
  - File attachments are streamed through the authenticated
    [`/api/slack/file`](../routes/api/slack/file/+server.ts) proxy so private
    Slack files render in the UI without exposing the bot token.
  - Requires `SLACK_BOT_TOKEN` + `SLACK_SIGNING_SECRET` in the environment.
- **Asana tasks** are placeholders: the "Create task" actions stamp a synthetic
  `gid` + URL onto the bug via [`asana-stamp.ts`](./asana-stamp.ts) so the
  workflow can be exercised end-to-end. See [`/api/asana`](../routes/api/asana/+server.ts).

## Auth

A single shared password gates the whole app (default: `john`). See
[`server/auth.ts`](./server/auth.ts) and [`hooks.server.ts`](../hooks.server.ts):
a successful login sets an HttpOnly session cookie; every protected page + API
route requires it. This keeps casual visitors out — it is **not** meant to
protect anything sensitive.

Override the defaults in the environment:

- `SONAR_PASSWORD` — the shared password (default `john`)
- `SONAR_SESSION_SECRET` — opaque session-cookie value (rotate to sign everyone out)

## Optional AI (Anthropic)

Local TF-IDF clustering is the default and needs no configuration. If you set
`ANTHROPIC_API_KEY` in the environment, the "AI" clustering toggle in the UI will
call Anthropic directly (via `fetch`, no SDK dependency) and fall back to local
clustering on any error. See [`cluster.ts`](./cluster.ts).

## API routes

Routes are under `/api` and require the session cookie, **except**
`/api/slack/events` (public; Slack signature-verified).

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/login` | POST | Validate the shared password, set the session cookie. |
| `/api/logout` | POST | Clear the session cookie. |
| `/api/cluster` | GET | Clusters + bugs + archived bugs. `?threshold=` and `?ai=true`. |
| `/api/bugs` | GET / POST | List bugs / file a new bug (validated with zod). |
| `/api/bugs/[id]` | GET / PATCH / DELETE | Read / partial-update / delete (delete needs `?confirm=true`). |
| `/api/bugs/[id]/advance` | POST | Resolver stage transition with gate checks + audit log + Slack follow-up. |
| `/api/bugs/[id]/sources` | POST | Append a Slack-thread source to an existing bug. |
| `/api/dedupe` | POST | Ranked similarity matches against existing bugs. |
| `/api/asana` | POST | Placeholder task-tracker writeback (stamps a synthetic gid/URL). |
| `/api/slack/events` | POST | **Public.** Slack Events webhook — ingests messages as bugs. |
| `/api/slack/file` | GET | Authenticated proxy that streams a private Slack file attachment. |

## Layout

```
src/
  hooks.server.ts            — password gate (page redirect + API 401)
  app.css / app.html         — Tailwind + fonts, no external auth script
  lib/
    server/auth.ts           — shared-password check + session cookie helpers
    server/slack.ts          — Slack Web API client + signature verification
    server/db/seed.ts        — `pnpm db:seed` script (seed/reset Postgres)
    schemas.ts               — zod schemas + types (Bug, Cluster, dedupe, etc.)
    constants.ts             — FEATURE_AREAS + normalization helpers
    seed-bugs.json           — synthetic seed data
    mocks.ts                 — Postgres-backed data store (async)
    cluster.ts / cluster-text.ts — clustering (local + optional AI)
    cluster-views.ts         — cluster-view derivations
    asana-stamp.ts           — placeholder task stamping
    stages.ts                — resolver state machine
    filter-helpers.ts, url-sync.ts, bug-actions.ts — page helpers
    styles/sonar.css         — bubble-viz styles
  routes/
    +page.svelte             — the radar
    login/+page.svelte       — sign-in
    resolver/[id]/           — ticket resolver
    components/              — header, bubble viz, cluster panel, modals, filters
    api/                     — the routes above
```

## Run it

```bash
pnpm install
pnpm dev      # http://localhost:5173
```

Deploys to Vercel as a standalone SvelteKit app (adapter-vercel is pre-configured).
