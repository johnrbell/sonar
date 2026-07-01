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

There is no database. The app seeds an in-memory store from
[`src/lib/seed-bugs.json`](src/lib/seed-bugs.json) — ~40 fictional bugs for a
made-up SaaS app ("Nimbus"). All writes live in memory for the session and reset
on restart. Edit `seed-bugs.json` to change the starting data.

## Integrations

None are live. The Slack/Asana wording and UI are kept as **cosmetic
placeholders** — Slack threads are just metadata, and "Create task" stamps a
synthetic Asana gid/URL onto the bug so the workflow can be exercised without any
real service.

## Configuration

All environment variables are optional — see [`.env.example`](.env.example):

| Variable | Default | Purpose |
| --- | --- | --- |
| `SONAR_PASSWORD` | `john` | The shared sign-in password. |
| `SONAR_SESSION_SECRET` | `sonar-session-v1` | Session-cookie value (rotate to sign everyone out). |
| `ANTHROPIC_API_KEY` | _(unset)_ | Enables the optional AI clustering mode. |

## Tech

SvelteKit 2 + Svelte 5 (runes), TypeScript, Tailwind CSS v4, d3, zod. Deploys to
Vercel via `@sveltejs/adapter-vercel` (pre-configured).

For architecture details, see [`src/lib/README.md`](src/lib/README.md).
