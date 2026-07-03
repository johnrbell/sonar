# Sonar

A **bug & feedback radar** with AI-assisted clustering and a ticket-resolver
workflow. This is a standalone, self-contained build: it runs on **synthetic
data**, has **no external service integrations**, and is protected by a single
shared password.

![Sonar radar](static/favicon.svg)

## Quick start

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173 and sign in with the password **`john`**.

## What's inside

- **Radar** — a d3 force-directed bubble view of incoming bugs, grouped into
  clusters of related issues.
- **Clustering** — local TF-IDF grouping by default; optional Anthropic AI mode
  if you supply your own `ANTHROPIC_API_KEY`.
- **Dedupe** — a similarity check to spot whether a new report already exists.
- **Ticket Resolver** — a per-ticket state machine (triage → pm-review →
  ready-for-eng → in-flight → done) with spec editing and an audit log.

## Data

Bugs are persisted in **Vercel Postgres** (one JSONB document per bug). The
store auto-creates its table and seeds from
[`src/lib/seed-bugs.json`](src/lib/seed-bugs.json) — ~40 fictional bugs for a
made-up SaaS app ("Nimbus") — on first access if empty. Edit `seed-bugs.json`
to change the starting data, and run `pnpm db:seed -- --force` to reset.

## Integrations

- **Slack** — a live bot. Messages in channels the bot is in are ingested as
  bugs (deduped, with file attachments) via a signed Events webhook, and
  resolved tickets post a follow-up back to their originating thread. Requires
  `SLACK_BOT_TOKEN` + `SLACK_SIGNING_SECRET`. See
  [`src/lib/README.md`](src/lib/README.md).
- **Asana** — still a cosmetic placeholder: "Create task" stamps a synthetic
  gid/URL onto the bug so the workflow can be exercised without a real service.

## Configuration

See [`.env.example`](.env.example):

| Variable | Default | Purpose |
| --- | --- | --- |
| `SONAR_PASSWORD` | `john` | The shared sign-in password. |
| `SONAR_SESSION_SECRET` | `sonar-session-v1` | Session-cookie value (rotate to sign everyone out). |
| `ANTHROPIC_API_KEY` | _(unset)_ | Enables the optional AI clustering mode. |
| `POSTGRES_URL` | _(required)_ | Vercel Postgres connection string (auto-set on Vercel; `vercel env pull` for local). |
| `SLACK_BOT_TOKEN` | _(unset)_ | Slack Bot User OAuth Token (`xoxb-…`) — enables reading/sending messages. |
| `SLACK_SIGNING_SECRET` | _(unset)_ | Verifies inbound Slack Events webhook requests. |

## Tech

SvelteKit 2 + Svelte 5 (runes), TypeScript, Tailwind CSS v4, d3, zod. Deploys to
Vercel via `@sveltejs/adapter-vercel` (pre-configured).

For architecture details, see [`src/lib/README.md`](src/lib/README.md).
