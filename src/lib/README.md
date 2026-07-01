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

There is **no database**. On boot the app seeds an in-memory store from
[`seed-bugs.json`](./seed-bugs.json) — ~40 fictional bugs for a made-up SaaS app
("Nimbus"). Writes (new bugs, edits, archives, stage transitions) live in process
memory for the session and reset on restart.

The store lives in [`mocks.ts`](./mocks.ts): `getMockBugs`, `getRuntimeBugs`,
`addRuntimeBug`, `updateMockBug`, `findMockBug`, `deleteMockBug`.

To regenerate or edit the seed set, just edit `seed-bugs.json` directly (it's a
plain array of `Bug` objects — see the `BugSchema` in [`schemas.ts`](./schemas.ts)).

## Integrations (all cosmetic)

The UI keeps **Slack** and **Asana**-flavored wording, but nothing calls out to
any real service:

- **Slack threads** are just provenance metadata stored on a bug
  (`slackThreads[]`). No Slack app, no tokens, no live search.
- **Asana tasks** are placeholders: the "Create task" actions stamp a synthetic
  `gid` + URL onto the bug via [`asana-stamp.ts`](./asana-stamp.ts) so the
  workflow can be exercised end-to-end. See [`/api/asana`](../routes/api/asana/+server.ts).
- The resolver's `in-flight → done` "resolved followup" is reported as a local
  no-op — there is no outbound post.

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

All routes are under `/api` and require the session cookie.

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/login` | POST | Validate the shared password, set the session cookie. |
| `/api/logout` | POST | Clear the session cookie. |
| `/api/cluster` | GET | Clusters + bugs + archived bugs. `?threshold=` and `?ai=true`. |
| `/api/bugs` | GET / POST | List bugs / file a new bug (validated with zod). |
| `/api/bugs/[id]` | GET / PATCH / DELETE | Read / partial-update / delete (delete needs `?confirm=true`). |
| `/api/bugs/[id]/advance` | POST | Resolver stage transition with gate checks + audit log. |
| `/api/bugs/[id]/sources` | POST | Append a Slack-thread source to an existing bug. |
| `/api/dedupe` | POST | Ranked similarity matches against existing bugs. |
| `/api/asana` | POST | Placeholder task-tracker writeback (stamps a synthetic gid/URL). |

## Layout

```
src/
  hooks.server.ts            — password gate (page redirect + API 401)
  app.css / app.html         — Tailwind + fonts, no external auth script
  lib/
    server/auth.ts           — shared-password check + session cookie helpers
    schemas.ts               — zod schemas + types (Bug, Cluster, dedupe, etc.)
    constants.ts             — FEATURE_AREAS + normalization helpers
    seed-bugs.json           — synthetic seed data
    mocks.ts                 — in-memory store
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
