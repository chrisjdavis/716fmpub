# VS-68 — Database query plan audit (archive, stats, imports, export, settings)

This document records how the hot paths touch PostgreSQL, which indexes defend them today, where cardinality explodes, and a prioritized remediation backlog. Automated `EXPLAIN (costs off)` checks for the listen- and import-job–shaped queries live in `packages/db/src/queryPlanAudit.integration.test.ts` (PGlite, ~4k canonical listens per case).

## Methodology

- **Source of truth:** SQL embedded in `@vs/db` (`dashboardAnalytics.ts`, `dashboardAnalyticsRecompute.ts`, `importJobs.ts`, `exportJobs.ts`, `listenSync.ts`, `userProfile.ts`) and call sites in `apps/web/src/server/*` and `apps/worker/src/listenExportZipGeneration.ts`.
- **Single source for dashboard listen-summary + hero EXPLAIN targets:** `getDashboardListenSummary` executes only the statements built by `buildDashboardListenSummaryStatementSpecs` in `packages/db/src/dashboardListenSummaryStatements.ts` (fragments in `dashboardAnalyticsSqlFragments.ts`). Hero “all” timeline and weekday-peak SQL are built by `packages/db/src/dashboardHeroStatements.ts`. `getListenSyncSummaryForUser` uses the exported `LISTEN_SYNC_SUMMARY_FOR_USER_SQL` constant in `packages/db/src/listenSync.ts`. Integration tests `EXPLAIN` those exact strings so text cannot drift from production paths.
- **Plans:** PGlite 0.4.x (same migrations as production). Representative statements mirror production predicates and joins; `EXPLAIN (ANALYZE, BUFFERS)` on staging/prod remains the definitive check under real buffer cache and row counts.
- **Regression guard:** The integration test asserts the large-table driver (`listens`, and where applicable `import_jobs`) does not fall back to a sequential scan on `listens` for the audited shapes.

## Relevant indexes (current schema)

| Table | Index | Role |
| --- | --- | --- |
| `listens` | `listens_user_id_played_at_idx` `(user_id, played_at)` | User-scoped time windows, `ORDER BY played_at`, keyset archive/export pages |
| `listens` | `listens_user_track_played_at_uidx` UNIQUE `(user_id, track_id, played_at)` | Dedup invariant; planner may use for some equality paths |
| `listens` | `listens_track_id_idx` `(track_id)` | Join fan-out from `tracks`, not primary for user dashboards |
| `listens` | `listens_import_job_id_idx` partial `(import_job_id)` | Provenance joins |
| `import_jobs` | `import_jobs_user_id_idx` `(user_id)` | Legacy from `imports`; supports filters on `user_id` |
| `import_jobs` | `import_jobs_user_id_stage_idx` `(user_id, stage)` | Stage-scoped counts |
| `import_jobs` | `import_jobs_user_one_active_stage_uidx` partial UNIQUE `(user_id) WHERE stage IN ('queued','running')` | Concurrency invariant |
| `export_jobs` | `export_jobs_user_id_created_at_idx` `(user_id, created_at DESC)` | Newest export rows per user |
| `export_jobs` | `export_jobs_stage_idx` partial on active stages | Worker / sweeper queries |
| `analytics_snapshots` | `UNIQUE (user_id, kind)` + `analytics_snapshots_user_id_idx` | Dashboard bundle read path |

## 1. Archive (`loadArchivePageData` → `@vs/db`)

**Call graph:** `tryReadFreshDashboardAnalyticsBundle` (optional) + `getDashboardListenSummary` / `getEarliestListenPlayedAtForUser` / `getArchiveListensPage` from `apps/web/src/server/archive-page-data.ts`.

| Query role | Implementation | Plan notes (PGlite, scaled fixture) |
| --- | --- | --- |
| All-time count & tops (when bundle missing) | `getDashboardListenSummary` | `listens` range filtered via `(user_id, played_at)` index; **top-artists** path builds a large intermediate (`labeled` → `bucketed` → `group by artist_key`) — CPU/hash-aggregate heavy at millions of rows per user |
| First / last timestamps | `getEarliestListenPlayedAtForUser` | `ORDER BY played_at ASC` uses backward/forward index scan on `listens_user_id_played_at_idx`, not `Seq Scan` |
| Paginated rows | `getArchiveListensPage` | No text needle: nested-loop from `listens` index to dimension tables; **with `q` set**, `position(lower(...) in lower(...))` prevents btree use on titles — expect **full filter** over the user’s window |

**High-cardinality / weak spots**

- Text archive search (`q`) is substring match over computed display strings — **O(window rows)** with no trigram index.
- Source filter joins `import_jobs` on `import_job_id`; selective enough once `listens` is index-driven.

## 2. Stats / dashboard (`loadDashboardPageData`)

**Call graph:** `getUserProfileFields`, `getLatestDashboardImportJobForUser`, then either `tryReadFreshDashboardAnalyticsBundle` or live `getDashboardListenSummary` + `getDashboardRecentListens` + `getDashboardHeroWindowMetrics` (+ extra queries for non-`all` ranges). See `apps/web/src/server/dashboard-page-data.ts`.

| Query role | Implementation | Plan notes |
| --- | --- | --- |
| Cached dashboard | `resolveDashboardAnalyticsBundleRead` / `tryReadFreshDashboardAnalyticsBundle` | Single-row read on `analytics_snapshots`; staleness probe `exists(select 1 from listens … played_at > as_of)` stays **index-backed** on `listens` (fixture test) |
| Live totals / tops | `getDashboardListenSummary` | Four parallel statements (count + three aggregates); each scans the same listen window — **repeated heap access** for the same `(user_id, played_at)` slice |
| Recent rail | `getDashboardRecentListens` | Index-friendly `ORDER BY played_at DESC, id DESC LIMIT n` |
| Hero charts | `getDashboardHeroWindowMetrics` | Weekday aggregate and daily dense series scan the full bounded window; “all time” timeline uses **monthly aggregation capped to 60 months** (`queryDashboardTimelineMonthlyRecent`) — bounded work |

**Query bursts (not ORM N+1, but correlated cost)**

- `recomputeDashboardAnalyticsBundle` loops four ranges × (`getDashboardListenSummary` ‖ `getDashboardRecentListens` ‖ `getDashboardHeroWindowMetrics`) plus `getEarliestListenPlayedAtForUser` — **dozens of heavy statements per recompute** (`packages/db/src/dashboardAnalyticsRecompute.ts`).
- Live dashboard without bundle repeats similar patterns per request.

## 3. Import progress (`loadImportsPageData`)

**Call graph:** `getUserProfileFields`, `getLatestDashboardImportJobForUser`, `countImportJobsForUser`, `getListenSyncSummaryForUser`, then `listImportJobsForUser`. See `apps/web/src/server/imports-page-data.ts`.

| Query role | Implementation | Plan notes |
| --- | --- | --- |
| Latest user job | `getLatestDashboardImportJobForUser` | `WHERE user_id AND source='user' ORDER BY created_at desc` — benefits from ** btree on `(user_id)`** plus sort unless planner uses index-only path |
| History page | `listImportJobsForUser` | Fixture: **no `Seq Scan` on `import_jobs`**; at scale prefer composite `(user_id, created_at DESC, id DESC)` to avoid explicit sort |
| Totals | `countImportJobsForUser` | Index-only or bitmap on `user_id` — cheap vs listens |
| Listen sync panel | `getListenSyncSummaryForUser` | Correlated subqueries on `import_jobs` filtered by `user_id` + `source` + `stage` / `max(updated_at)` — fixture avoids `Seq Scan` on `import_jobs`; partial index `(user_id, source) WHERE …` is a future win if row counts grow |

**N+1 style**

- None in the HTTP loader itself: uses `Promise.all` then one paged `listImportJobsForUser`. Worker-side import persistence is out of scope here.

## 4. Export (`listenExportZipGeneration`)

**Call graph:** `getArchiveListensPage` in a loop (`EXPORT_BATCH_LIMIT = 2000`) until partial page — `apps/worker/src/listenExportZipGeneration.ts`.

| Pattern | Risk | Mitigation already / proposed |
| --- | --- | --- |
| **Sequential pages** | One round-trip per 2k rows (expected) | Keep keyset pagination (already `played_at, id`); avoid OFFSET |
| Same SQL as archive | Index behavior matches archive audit | Ensure production `ANALYZE` on `listens` after bulk imports |
| Progress updates | `updateExportJobListenProgress` per batch | Batching frequency vs WAL — optional coalesce writes |

**Related export metadata**

- `getExportJobByIdForUser`, `tryMarkExportJobRunning`, `markExportJobCompleted` hit `export_jobs` by **primary key + `user_id` guard** — cheap.
- `markExportJobCompleted` may call `getExportJobByIdForUser` again on conflict paths — **duplicate read**, acceptable.

## 5. Settings (`getUserProfileFields`)

**Implementation:** `select … from users where id = $1 limit 1` (`packages/db/src/userProfile.ts`).

- Single-row PK lookup — negligible vs listens; test asserts plan touches `users` only.

---

## Risk register: sorts, filters, and groupings at scale

| Area | Pattern | Why it hurts | Detection |
| --- | --- | --- | --- |
| Dashboard tops | `GROUP BY` / `md5` over derived artist keys | Large hash aggregates and sorts per request | `EXPLAIN (ANALYZE)` on `getDashboardListenSummary` for a power user; compare with bundle snapshot path |
| Archive search | `position(...)` on titles / artist / album strings | Full scan of user window | `EXPLAIN` with `q` populated |
| Hero “all” | Monthly rollup over **all** listens | Linear in listen count (capped to 60 output rows but input aggregation still large) | `EXPLAIN` on `queryDashboardTimelineMonthlyRecent` |
| Top tracks / albums | Joins + `max(jsonb…)` for cover URL | Per-group JSON work | Flame graphs / `EXPLAIN ANALYZE` |

## Prioritized remediation plan

| Priority | Item | Action | Rationale |
| --- | --- | --- | --- |
| P0 | Prove production plans | Run `EXPLAIN (ANALYZE, BUFFERS)` for the statements in this doc against a snapshot with realistic row counts; archive **with and without** `q` | PGlite ≠ prod memory/parallelism |
| P1 | Import job ordering | Add composite index `import_jobs (user_id, created_at DESC, id DESC)` INCLUDE optional columns **or** match partial filters for dashboard (`source`, `stage`) if EXPLAIN shows repeated large sorts | Aligns with `ORDER BY created_at desc, id desc` on user-scoped lists |
| P1 | Dashboard live path | Prefer `tryReadFreshDashboardAnalyticsBundle` + worker recompute (already implemented); monitor staleness SLO so live fallback stays rare | Cuts duplicate scans already identified in bundle design |
| P1 | Listen-sync summary | Consider partial index on `import_jobs (user_id, source, stage)` or `(user_id, source)` where `source='system_sync'` if subqueries show bitmap heap churn | Targets `getListenSyncSummaryForUser` |
| P2 | Archive text search | Add `pg_trgm` GIN indexes on normalized `tracks.title`, artist display, album title **or** push search to a dedicated store | Substring search cannot use btree |
| P2 | Cover URL extraction | Move `LASTFM_COVER_IMAGE_URL_SQL` to a persisted column populated at ingest | Reduces per-aggregate JSON parsing |
| P2 | Hero “all” timeline | Precompute monthly buckets in snapshot or materialized view | Shrinks repeated full-table user scans |

## Follow-ups for operators

- After large imports, run **`ANALYZE listens`** (and dimension tables) so the planner keeps using `listens_user_id_played_at_idx`.
- Track **dashboard bundle age** vs listen ingestion rate; stale bundles trigger the expensive live query set (`dashboard-page-data.ts`).
