# 716FM

Open-source, **single-user** Last.fm listening analytics. Self-host your archive: import scrobbles, explore stats, export data. All product features are unlocked — no plans, invites, or admin console.

## Features

- Last.fm full history import and incremental sync
- Dashboard, archive, Musical Time Machine explore, and listen exports
- Optional public Explore/Archive (`/explore`, `/archive`) when enabled in Settings
- Layer 1 listening evidence / insights (unlocked)
- One local owner account via first-run `/setup`

## Stack

- `apps/web` — Next.js App Router UI + API
- `apps/worker` — BullMQ consumers + import tick loop
- `apps/realtime` — optional WebSocket listen push
- PostgreSQL + Redis (Docker Compose)

## Prerequisites

- Node.js 20+
- Docker (for Postgres + Redis)

## Quick start

```bash
cp .env.example .env
# Set DATABASE_URL, REDIS_URL, and LASTFM_API_KEY in .env

docker compose up -d postgres redis
npm install
npm run db:migrate
npm run run:all
```

Open [http://127.0.0.1:3456/setup](http://127.0.0.1:3456/setup), create the owner account, then connect your Last.fm username under onboarding / settings.

### Environment

| Name | Required | Purpose |
|------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes (unless `skipRedisQueues`) | Redis for BullMQ |
| `LASTFM_API_KEY` | Yes for imports | [Last.fm API key](https://www.last.fm/api/account/create) |
| `VS_EMAIL_ENABLED` | No | Leave unset/`false` for OSS (no Mailgun) |

See [`.env.example`](./.env.example) for the full list. Email verification and transactional mail are **off by default**.

### Single-user model

- First visit with an empty database: `/setup` creates the sole owner (verified, Advanced entitlements).
- Further account creation is rejected (`409 already_configured`).
- Sign in at `/login`. There is no public signup or admin UI.

## License

MIT — see [LICENSE](./LICENSE).

## Development notes

- Prefer small, scoped changes; SQL migrations live under `packages/db/migrations/`.
- Run `npm test` from the repository root before handing off work that touches shared packages.
- Database setup and migrations: `npm run db:migrate`, `npm run db:validate`.
