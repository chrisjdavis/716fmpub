# Performance audit baseline (VS-64)

This document is the **benchmark anchor** for later optimization work. Numbers are **environment-specific**; always record git SHA, deploy mode, and hardware when updating [`docs/performance-baseline/recorded-2026-04-16-local.json`](./performance-baseline/recorded-2026-04-16-local.json) or successor files.

The checked-in JSON uses **`schemaVersion`: 2** and a top-level **`benchmarkContract`**: every metric the ticket names must appear there as either a **measured number** or a **`value: null` + `reason`** pair (no silent omissions).

## Architecture (current system)

### Rendering

- **Framework:** Next.js 15 App Router (`apps/web`). Marketing and auth screens mix **React Server Components** and **client islands** (`"use client"` for forms, dashboard interactivity, archive browser, fingerprint poller).
- **Dashboard shell:** `apps/web/src/app/dashboard/layout.tsx` wraps authenticated pages; data-heavy routes (`/dashboard`, `/dashboard/archive`, `/dashboard/imports`, `/dashboard/settings`) load models in **async server components** via `@/server/*-page-data` modules, then hydrate client widgets where needed.
- **Dynamic policy:** `/dashboard` uses `export const dynamic = "force-dynamic"` so range-specific stats are never served from a stale shared shell.

### HTTP APIs

- **JSON under `/api/*`:** Session-backed routes use `withApiSession` / edge session gates; mutating routes require **CSRF double-submit** (`vs_csrf` cookie + `x-csrf-token` header).
- **Representative endpoints for this audit:** `GET /api/me`, `GET /api/analytics/summary`, `GET /api/imports/latest`, `GET /api/me/listen-fingerprint`, `GET /api/me/listen-realtime`, `POST /api/export/listens`.

### WebSocket / realtime

- **Path:** Postgres `NOTIFY listen_change` → `apps/realtime` (`ws` server) → browser `WebSocket` in `DashboardListenFingerprintPoller` (`apps/web/src/app/dashboard/dashboard-listen-fingerprint-poller.tsx`).
- **Handshake:** Browser calls `GET /api/me/listen-realtime` for `{ enabled, wsUrl, token }`, connects, sends `{ type: "auth", token }`, expects `{ type: "ready" }` before `listens_updated` push events.
- **Fallback:** If realtime is disabled or the socket drops, the UI falls back to **HTTP polling** on `/api/me/listen-fingerprint` on `LISTEN_FINGERPRINT_POLL_MS` from `@vs/domain/listen-fingerprint-poll`.

### Queue (BullMQ)

- **Redis-backed queues** in `@vs/queue` enqueue import, export, analytics, and listen-sync jobs when `FEATURE_FLAGS.skipRedisQueues` is false and `REDIS_URL` is set.
- **Export initiation:** `POST /api/export/listens` creates a row, enqueues BullMQ work, returns **202** when accepted (see `apps/web/src/app/api/export/listens/route.ts`). Latency here includes **DB + Redis producer** work, not ZIP materialization (worker).

### Database

- **Primary store:** PostgreSQL via `pg` pools from `@vs/db`.
- **Hot paths for audited pages:** `loadDashboardPageData`, `loadArchivePageData`, `loadImportsPageData`, `getUserProfileFields` (see `apps/web/src/server/*-page-data.ts` and `packages/db` for query definitions). Optional precomputed analytics bundles are read when fresh (`tryReadFreshDashboardAnalyticsBundle`).

---

## Measurement methodology

| Signal | How we measure | Tooling |
| --- | --- | --- |
| Server / HTML response | Wall time until response body fully read (`msTotal`); `msHeaders` ≈ time to status + headers | `npm run perf:baseline -w web` (`apps/web/scripts/performance-baseline.ts`) |
| API JSON | Same fetch timers on authenticated `GET`/`POST` | `perf:baseline` |
| DB **loader** latency (aggregate) | `performance.now()` around page-data loader functions (several SQL statements per loader) | `npm run perf:baseline:db -w web` |
| DB **per-query** Postgres time | `value: null` + reason in JSON until `EXPLAIN (ANALYZE)` or `pg_stat_statements` is wired | Manual / future harness |
| `next start` authenticated HTML | `value: null` + reason in JSON: **Secure session cookies are not persisted by Node `fetch` on plain `http://127.0.0.1` when `next start` runs under production `NODE_ENV`** | HTTPS local trust (e.g. mkcert), Playwright, or Lighthouse handoff |
| Bundle / JS cost | Next build route table: **First Load JS** (kB) + middleware kB | `npm run build -w web` |
| Hydration / main-thread / LCP | **`value: null` + reason** until Lighthouse JSON is attached | `npx lighthouse <url> --only-categories=performance --preset=desktop --output=json` |
| WebSocket **control plane** (auth → `ready`) | Milliseconds from WS connect to first `{type:\"ready\"}` when realtime is enabled | `npm run perf:baseline:ws -w web` |
| WebSocket **data plane** (`listen_change` → `listens_updated`) | **`value: null` + reason** until a controlled `listens` mutation + `apps/realtime` is part of the harness | Documented contract only in default capture |

**Honesty constraints:** `next dev` timings include **compilation and HMR overhead** and are **not** production SLOs. The first authenticated dashboard hit after server start can exceed **600 ms** while routes compile; steady-state warm numbers are lower. **`benchmarkContract.serverResponseTimes.nextStartAuthenticated`** documents why we do not pretend to have scripted `next start` numbers on plain HTTP.

---

## Baseline metrics (recorded)

**Source file:** [`docs/performance-baseline/recorded-2026-04-16-local.json`](./performance-baseline/recorded-2026-04-16-local.json)  
**Git SHA:** `5647d36db21edde84f7798845a85d1352fb790f9`  
**Stack:** Migrated local Postgres (`127.0.0.1:55432`), Redis (`127.0.0.1:56379`), seeded `dev@local.test`, **`next dev` on port 3460**.

### Key flows — HTTP (`msTotal`, rounded)

| Flow | Request | msTotal (warm dev) | Response bytes (approx) |
| --- | --- | ---: | ---: |
| Home load | `GET /` | 84 | 50.8 KB |
| Stats load | `GET /dashboard?range=30d` | 59 | 45.1 KB |
| Archive load | `GET /dashboard/archive` | 63 | 43.6 KB |
| Export initiation | `POST /api/export/listens` | 25 | 202 Accepted |
| Export screen | `GET /dashboard/export` | 75 | 60.5 KB |
| Import status (`GET /api/imports/latest` only) | `GET /api/imports/latest` | 14 | 15 B JSON |
| Imports screen | `GET /dashboard/imports` | 76 | 59.2 KB |
| Settings load | `GET /dashboard/settings` | 50 | 49.9 KB |
| Listen fingerprint (poll contract) | `GET /api/me/listen-fingerprint` | 14 | 41 B |
| Realtime handshake | `GET /api/me/listen-realtime` | 15 | 17 B (`enabled: false` on this run) |

**Cold compile reference (same machine, first hit after boot):** `GET /dashboard?range=30d` reached **~670 ms** `msTotal` before the route was warm — flagged as **tooling noise**, not tenant data cost.

### Key flows — DB **loader** latency only (`ms`, same commit)

These are **aggregate** server-side timings around loader functions (each may run multiple SQL statements). They are **not** single-query `EXPLAIN (ANALYZE)` numbers.

| Block | ms |
| --- | ---: |
| `loadDashboardPageData` (`30d`) | 10.9 |
| `loadArchivePageData` | 24.3 |
| `loadImportsPageData` (page 1) | 12.0 |
| `getUserProfileFields` | 60.5 |

The `getUserProfileFields` sample is an **outlier vs other loaders** on this run; treat it as **needs confirmation** under repeated sampling or per-query analysis before optimization.

**Import status in the live UI:** the imports dashboard also refreshes when the listen fingerprint changes or when a WebSocket `listens_updated` event fires; see `benchmarkContract.clientRendering.importStatusUpdates` in the JSON for the explicit split between **`GET /api/imports/latest`** and those other contracts.

### Bundle weight — `next build` (First Load JS, kB)

| Route | First Load JS |
| --- | ---: |
| `/` | 109 |
| `/dashboard` (stats) | 124 |
| `/dashboard/archive` | 110 |
| `/dashboard/export` | 107 |
| `/dashboard/imports` | 122 |
| `/dashboard/settings` | 109 |
| Shared baseline | 102 |
| Middleware | 49.2 |

**Hydration / interactivity cost:** infer **only** coarse bounds from First Load JS + client chunk layout. For **Main thread / hydration ms**, capture Lighthouse (`performance` mode) or Web Vitals in a **production** `next start` profile and attach a new JSON row under `docs/performance-baseline/`.

### WebSocket timings

- **HTTP handshake** (`GET /api/me/listen-realtime`): see `httpMs.api_me_listen_realtime_handshake_msTotal` and `benchmarkContract.websocket.httpHandshakeListenRealtimeApiMs` (**~15 ms** this run with realtime disabled in env).
- **Control plane** (browser-equivalent: connect → auth → `{type:"ready"}`): run `npm run perf:baseline:ws -w web` with `apps/realtime` up; otherwise **`wsAuthToReadyMs.value` is null** with reason in JSON.
- **Data plane** (`listen_change` NOTIFY → `{type:\"listens_updated\"}`): **`notifyListenChangeToListensUpdatedMs.value` is null** with reason until we add a harness that performs a controlled `listens` mutation for the benchmark user.

---

## What is “too slow” here? (evidence-based)

Using **explicit dev budgets** for this baseline only (not product SLAs):

| Observation | Evidence | Verdict |
| --- | --- | --- |
| First-hit dashboard latency | `stats_dashboard_html` ~670 ms cold vs ~59 ms warm | **Investigate before optimizing SQL** — dominated by dev compilation, not DB loaders alone (loaders ~11 ms). |
| Largest dashboard First Load JS | `/dashboard/imports` **122 kB** vs `/dashboard/export` **107 kB** | **Largest authenticated route JS** in the build table — candidate for future code-splitting review. |
| Heaviest HTML payload (this tenant) | `/dashboard/export` ~60 KB HTML | Worth watching when copy/marketing grows; not yet a runtime outlier (still under 80 ms server-side here). |
| Micro-DB outlier | `getUserProfileFields` **60 ms** vs other loaders &lt; 25 ms | **Sample again** under production pool settings before treating as a regression. |

---

## How to reproduce

1. Migrate + seed: `npm run db:migrate` and `npm run seed:local -w web` (see [README](../README.md)).
2. Start web: `npm run dev -w web` (or documented port).
3. **HTTP + API JSON + embedded `benchmarkContract`:** `SMOKE_BASE_URL=http://127.0.0.1:3456 npx dotenv -e .env -- npm run perf:baseline -w web`
4. **DB loaders:** `cd apps/web && npx dotenv -e ../../.env -- npx tsx scripts/performance-db-baseline.ts` (or `npm run perf:baseline:db -w web` from repo root).
   - **VS-83 (imports loader + audit log):** the DB script prints a `vs83` object with audited routes and a **warm repeat** timing for `loadImportsPageData` page 1. To compare against a checked-in snapshot (same machine, comparable data volume), run with  
     `VS83_PERF_PRIOR_JSON=docs/performance-baseline/recorded-2026-04-16-local.json`  
     and read `vs83.priorComparison.deltaMs` (negative means faster than the prior `dbLoaderMs.loadImportsPageData_page1` number).
   - **Listen transport (VS-83):** the dashboard fingerprint poller **does not** call `GET /api/me/listen-fingerprint` on mount when the realtime handshake runs; HTTP polling still starts when realtime is disabled or the socket falls back to polling.
5. **WebSocket control plane (optional):** with web + realtime + secrets configured, `npm run perf:baseline:ws -w web`
6. **Bundle table:** `npm run build -w web` and align `nextBuildFirstLoadJsKb` + **`middlewareKb`** with the printed table (single source of truth).

---

## CI / release performance gates (VS-84)

- **Bundle:** `npm run perf:check:budgets -w web` runs a production `next build` and fails when First Load JS for enforced dashboard routes, shared JS, or middleware exceeds [`docs/performance-budgets/vs-84-budgets.json`](./performance-budgets/vs-84-budgets.json). The same check runs on every pull request (see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).
- **Recorded warm paths:** Vitest compares [`docs/performance-baseline/recorded-2026-04-16-local.json`](./performance-baseline/recorded-2026-04-16-local.json) against the `httpMsMax` and `dbLoaderMsMax` envelopes in that budgets file so snapshot updates cannot silently exceed declared ceilings.
- **Representative query (PGlite):** [`packages/db/src/import-list-query-performance-budget.integration.test.ts`](../packages/db/src/import-list-query-performance-budget.integration.test.ts) bounds wall time for `listImportJobsForUserWithTotalCount` on a scaled fixture; ceilings live in [`docs/performance-budgets/vs-84-pglite-query-budgets.json`](./performance-budgets/vs-84-pglite-query-budgets.json).

**Release readiness (critical user paths):** for a release candidate, re-run the steps in **How to reproduce** (items 3–6) on a production-like stack. When material numbers move, commit refreshed JSON under `docs/performance-baseline/` and raise `vs-84-budgets.json` only with an explicit rationale. Confirm the CI performance budget step is green on the merge commit.

**Rollout sequencing and 100-user validation:** see [`docs/performance/vs-85-rollout-plan.md`](./performance/vs-85-rollout-plan.md) (TASK 8.2).

Commit updated JSON under `docs/performance-baseline/` when you change hardware, data volume, or major dependencies.
