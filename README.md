# 716FM

Open-source, **single-user** Last.fm listening analytics you run yourself.

Import your scrobbles, explore your archive, export your data, and optionally publish Explore/Archive for others to browse. One owner account, all features unlocked — no plans, invites, signup, or admin console.

## What you get

- Last.fm full-history import and background incremental sync
- Dashboard, archive, Musical Time Machine (`/explore`), and listen exports (JSON/CSV ZIP)
- Optional public Explore/Archive at `/explore` and `/archive` (off by default; toggle in Settings)
- Layer 1 listening evidence / insights (unlocked in this edition)
- First-run owner bootstrap at `/setup`

## Stack

| Piece | Role |
|-------|------|
| `apps/web` | Next.js UI + HTTP API (default [http://127.0.0.1:3456](http://127.0.0.1:3456)) |
| `apps/worker` | BullMQ jobs: imports, sync, exports, analytics |
| `apps/realtime` | Optional WebSocket listen push (default `ws://127.0.0.1:3457`) |
| PostgreSQL + Redis | Data store and job queues (Docker Compose on this repo) |

## Prerequisites

- **Node.js 20+**
- **npm** (workspaces)
- **Docker** (Postgres + Redis via Compose)
- A **[Last.fm API key](https://www.last.fm/api/account/create)** for real imports

## Quick start (local)

### 1. Clone and configure env

```bash
cp .env.example .env
```

Edit `.env` and set at least:

```bash
DATABASE_URL=postgresql://listen:listen@127.0.0.1:55432/listen
REDIS_URL=redis://127.0.0.1:56379
LASTFM_API_KEY=your_lastfm_api_key

# Required for `npm run run:all` (starts the realtime service)
REALTIME_JWT_SECRET="$(openssl rand -base64 48)"
LISTEN_REALTIME_ENABLED=true
LISTEN_REALTIME_WS_URL=ws://127.0.0.1:3457
NEXT_PUBLIC_LISTEN_REALTIME_WS_URL=ws://127.0.0.1:3457
LISTEN_REALTIME_PORT=3457
```

Compose maps **Postgres to host `55432`** and **Redis to host `56379`** so they do not collide with local installs. Those ports match `.env.example`.

Optional but recommended for a durable single-user box:

```bash
# Encrypt Last.fm keys at rest (32 bytes)
VS_SECRETS_ENCRYPTION_KEY="$(openssl rand -base64 32)"

# Persist export ZIPs outside the OS temp dir
EXPORT_ARTIFACTS_DIR=/absolute/path/to/export-artifacts
```

Leave `VS_EMAIL_ENABLED=false` (default) unless you intentionally configure Mailgun.

### 2. Start databases

```bash
docker compose up -d postgres redis
```

### 3. Install, migrate, run

```bash
npm install
npm run db:migrate
npm run run:all
```

`run:all` starts **web + worker + realtime** together.

Web-only + worker (no live listen push):

```bash
# In .env: LISTEN_REALTIME_ENABLED=false and omit REALTIME_JWT_SECRET
npm run dev          # terminal 1 — web on :3456
npm run dev:worker   # terminal 2
```

### 4. Create the owner account

1. Open [http://127.0.0.1:3456/setup](http://127.0.0.1:3456/setup) (or use **Set up** on the home page when the instance is empty).
2. Enter email + password (minimum **12** characters, at least **two distinct** characters).
3. If you set `VS_SETUP_BOOTSTRAP_SECRET` in `.env`, enter the same value in the bootstrap secret field.
4. You land on the dashboard / onboarding flow.

Then:

- Connect your **Last.fm username** (and optional personal API key) in onboarding or **Settings**
- Start a **full history import**
- Use **Explore**, **Archive**, and **Export** from the dashboard

Sign in later at [http://127.0.0.1:3456/login](http://127.0.0.1:3456/login). There is **no public signup**.

### 5. Optional: public listening pages

In **Settings**, enable “Make Explore and Archive public”. When on, unauthenticated visitors can open `/explore` and `/archive` for this sole-owner instance.

## Environment cheat sheet

Full comments live in [`.env.example`](./.env.example). Common keys:

| Variable | Local | Staging / production | Purpose |
|----------|-------|----------------------|---------|
| `DATABASE_URL` | Required | Required | PostgreSQL |
| `REDIS_URL` | Required\* | Required (`rediss://` in `production` tier) | BullMQ |
| `LASTFM_API_KEY` | Required for imports | Same | Last.fm API |
| `REALTIME_JWT_SECRET` | Required if realtime on / `run:all` (≥16) | ≥32 when realtime enabled | Sign listen WebSocket tokens |
| `VS_SETUP_BOOTSTRAP_SECRET` | Optional (≥16 if set) | **Required** (≥32) | Gates `/setup` so an empty `users` table cannot be claimed by strangers |
| `VS_PUBLIC_APP_ORIGIN` | Optional | **Required** (`https://…`) | Canonical origin for HTTPS redirects and auth Host/Origin checks |
| `VS_TRUST_PROXY_HEADERS` | Optional | **Required** `true` or `false` | Trust forwarded headers only when your reverse proxy overwrites them |
| `EXPORT_ARTIFACTS_DIR` | Optional (temp default) | **Required** | Shared ZIP directory for worker writes / web downloads |
| `VS_SECRETS_ENCRYPTION_KEY` | Optional | Recommended | AES-GCM for stored Last.fm keys |
| `VS_EMAIL_ENABLED` | Default `false` | Opt-in | Transactional email (Mailgun when enabled in strict tiers) |

\*Or set `FEATURE_FLAGS={"skipRedisQueues":true}` for Postgres-only experiments. Imports/exports that need the queue return errors; not recommended for real use.

### Setup security note

Whenever `users` is empty (fresh install **or** after you delete the owner account in Settings), `/setup` is available again. In staging/production, `VS_SETUP_BOOTSTRAP_SECRET` is mandatory so only someone with that secret can claim the instance.

## Day-to-day commands

```bash
npm run run:all          # web + worker + realtime
npm run dev              # web only
npm run dev:worker       # worker only
npm run dev:realtime     # realtime only
npm run db:migrate       # apply SQL migrations
npm run db:validate      # migration / schema checks
npm test                 # monorepo tests
```

## Production / VPS deploy

For a single-Droplet Docker + Caddy stack, follow:

- [docs/runbooks/digitalocean-pilot-deploy.md](./docs/runbooks/digitalocean-pilot-deploy.md)
- Env templates: [`deploy/digitalocean/pilot.env.example`](./deploy/digitalocean/pilot.env.example), [`deploy/digitalocean/managed.env.example`](./deploy/digitalocean/managed.env.example)

Checklist before exposing the app on the internet:

1. Set `VS_DEPLOY_ENV` to `staging` or `production` as appropriate.
2. Set `VS_PUBLIC_APP_ORIGIN`, `VS_TRUST_PROXY_HEADERS`, `VS_SETUP_BOOTSTRAP_SECRET`, and `EXPORT_ARTIFACTS_DIR`.
3. Use a strong `REALTIME_JWT_SECRET` if listen realtime is enabled.
4. Prefer `VS_SECRETS_ENCRYPTION_KEY` so Last.fm keys are not stored plaintext.
5. Put TLS in front (Caddy/nginx) and do not publish Postgres/Redis ports publicly.

Security architecture notes: [docs/security-architecture.md](./docs/security-architecture.md).

## License

Apache License 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

## Contributing / development

- Prefer small, scoped changes; SQL migrations live under `packages/db/migrations/`.
- Do not reintroduce SaaS surfaces (multi-user signup, beta invites, plan gates, admin console) unless explicitly requested.
- Run `npm test` from the repository root before handing off work that touches shared packages.
