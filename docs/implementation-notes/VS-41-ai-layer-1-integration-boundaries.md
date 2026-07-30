# VS-41 — AI Layer 1 signal engine: real integration boundaries (716FM)

Implementation-oriented map of **existing** services, data, queues, and surfaces. Extend these modules; do not add a parallel “demo” pipeline.

## Listening history: source of truth

| Layer | Tables / rows | Owner module |
| --- | --- | --- |
| Ingested Last.fm pages (JSON per track) | `raw_scrobbles` (`raw_payload`, `uts`, `played_at`, FK `import_job_id`) | `packages/db/src/rawScrobbles.ts`, `packages/db/src/canonicalizeRawScrobbles.ts` |
| Canonical plays | `listens` (FK `track_id`, optional `raw_scrobble_id`, `import_job_id`) | SQL + read paths in `packages/db/src/dashboardAnalytics.ts`, `timeMachinePeriod.ts`, etc. |
| Catalogue dimensions | `artists`, `albums`, `tracks` | Created/linked during canonicalization |

Schema history lives under `packages/db/migrations/` (node-pg-migrate `.cjs` modules). Core listen graph: `1744560000002_core-schema-import-jobs-scrobbles-listens.cjs`.

## Rollups, stats, and precomputed read models

| Artifact | Storage | Computation |
| --- | --- | --- |
| Period / artist rollups | `user_listen_period_metrics`, `user_artist_listen_stats` | `packages/db/src/listenPeriodMetricsRecompute.ts` — worker job `listen_period_metrics` |
| Daily rollup rows | `user_listen_daily_metrics` | `packages/db/src/userListenDailyMetricsRecompute.ts` — refreshed from `listenPeriodMetricsRecompute.ts` (same chain as `listen_period_metrics` worker job) |
| Dashboard-sized bundle | `analytics_snapshots` row `kind = dashboard_bundle_v1` | `packages/db/src/dashboardAnalyticsRecompute.ts` via analytics job `windowed_aggregate` |
| Window / “signal” style snapshot | `analytics_snapshots` `user_window_signals_v1` | Same `recomputeDashboardAnalyticsBundle` path → `userWindowSignalsRecompute.ts` |
| Import ingest fingerprint | `analytics_snapshots` `listen_fingerprint_v1` | `listenFingerprintReadModel.ts` (same bundle recompute) |
| Home briefing | `analytics_snapshots` `home_briefing_v1` | `homeBriefingSnapshot.ts` (loaded for home; see `apps/web/src/server/load-dashboard-home-briefing.ts`) |

Purge contract for “all listen data” is documented in `packages/db/src/purgeUserListenData.ts` (lists tables touched).

## Imports and Last.fm

- **HTTP API (user):** `POST/GET /api/imports` → `apps/web/src/app/api/imports/route.ts` → `enqueueUserLastfmImport` (`apps/web/src/server/enqueue-user-lastfm-import.ts`) creates `import_jobs` and enqueues BullMQ.
- **Onboarding:** `apps/web/src/app/api/onboarding/import/*`, `onboarding/lastfm/*`.
- **Worker ingestion:** `apps/worker/src/importQueueProcessor.ts`, `runQueuedLastfmImport.ts`, `mapImportListenEventToRawRow.ts`; bounded catch-up: `incrementalSyncQueueProcessor.ts`, `listenCatchupBullMq.ts`, tick `runListenSyncEnqueueTick.ts`.
- **Shared Last.fm client:** `packages/lastfm-provider` (wraps `scrobbles` npm CLI shape — aligned with `scripts/lastfm-dump-sample.mjs`).

## Background processing: BullMQ

- **Queue names:** `packages/queue/src/queue-names.ts` (`VS_QUEUE_NAMES`: `imports`, `exports`, `analytics`, `sync`, `incremental_sync`, `vs-smoke-test`).
- **Validated payloads / job names:** `packages/queue/src/job-contracts.ts` (e.g. `lastfm_rows_import`, `windowed_aggregate`, `listen_period_metrics`, `listen_catchup`).
- **Worker registration:** `apps/worker/src/registerBullMqWorkers.ts` → `importQueueProcessor`, `exportQueueProcessor`, `analyticsQueueProcessor`, `incrementalSyncQueueProcessor`, sync listener catch-up enqueue.
- **Post-import analytics enqueue:** `apps/worker/src/enqueueDashboardAnalyticsAfterImport.ts` + `packages/queue/src/analytics-dashboard-enqueue.ts`.
- **Operator inspection (CLI, not product UI):** `apps/worker/scripts/inspect-bullmq-queues.ts`, `inspect-stalled-db-jobs.ts`.
- **Developer enqueue (non-production, VS-51):** `npm run enqueue:layer1-recompute` → `apps/worker/scripts/enqueue-layer1-recompute.ts` enqueues `layer1_evidence_recompute` with explicit user ids or a cursor batch (`enqueueLayer1EvidenceRecomputeExplicitUsers` / `enqueueLayer1EvidenceRecomputeUserCursorBatch` in `packages/queue/src/analytics-dashboard-enqueue.ts`).
- **Performance and failure-mode contracts (VS-56):** `docs/performance/vs-56-layer1-performance-and-failure-modes.md` (batch limits, play-row cap, logging, recovery).

Worker process entry: `apps/worker/src/index.ts` (ticks: `runImportTick`, `runListenSyncEnqueueTick`, export recovery/cleanup).

## API and service boundaries (Next.js `apps/web`)

- **Session user analytics:** `apps/web/src/app/api/analytics/*` (summary, recent-listens, archive-listens).
- **Listen data / fingerprint / realtime token:** `apps/web/src/app/api/me/listen-data`, `listen-fingerprint`, `listen-realtime`.
- **Exports:** `apps/web/src/app/api/export/listens/*`.
- **Machine / worker callbacks (bearer-secret internal JSON):** `apps/web/src/app/api/internal/*` — see `apps/web/src/server/api/internal-api-paths.ts` and `middleware-rate-limit.ts` (internal prefix exempt from some limits). Examples: cache invalidation, onboarding notify, `internal/analytics/dashboard-default-snapshot`.
- **Staff admin JSON + RSC:** `apps/web/src/app/api/admin/*` (users, overview, invites, health); HTML under `apps/web/src/app/admin/*` gated by `require-admin-server-session.ts` / `admin-surface-eligibility.ts`.

## Where to hang Layer 1 “signals” without a greenfield stack

1. **Dashboard-sized aggregates** stay on `windowed_aggregate` → `recomputeDashboardAnalyticsBundle` (`dashboard_bundle_v1`, `user_window_signals_v1`, listen fingerprint snapshot). That path **does not** write `layer1_evidence_objects`; the worker chains **`enqueueLayer1EvidenceRecomputeForUserBestEffort`** when product policy should refresh Layer 1 for the same user.
2. **Durable Layer 1 evidence** ships on `layer1_evidence_recompute` → `runLayer1EvidenceRecomputeJob` with explicit `enqueueReason` audit vocabulary (`packages/queue/src/job-contracts.ts`). Add new listen-derived **evidence** here (or extend the existing signal builder), not inside the dashboard bundle function.
3. **Prefer new `analytics_snapshots.kind` values** (or new columns on existing rollup tables) for non–Layer-1 rollups over ad-hoc client inference — snapshots already carry schema versions and parser contracts in `@vs/db`.
4. **Enqueue from the same choke points** as today: post-import and listen-ingest hooks, `windowed_aggregate` tail, Advanced reconciliation tick, admin repair routes, and explicit operator scripts. Lifecycle detail: [VS-92](./VS-92-task-9-1-layer1-automation-lifecycle.md).

## Realtime note (context only)

Listen change fan-out uses Postgres `NOTIFY` on `listens` (see `docs/performance/vs-71-websocket-audit.md`). Layer 1 offline signals should still treat **`listens` + `analytics_snapshots`** as the durable contract, not websocket timing.
