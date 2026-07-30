# VS-77 — Caching plan (API, DB, derived views)

This document classifies cache opportunities against the product constraints: **backend as source of truth**, **no fake precision**, **deterministic contracts**, and **visible failure/stale states**. It complements [`docs/analytics/read-models.md`](../analytics/read-models.md), which is the canonical description of existing snapshot kinds.

## Current baseline (already caching)

| Mechanism | Pattern | What it caches | Freshness | Invalidation / refresh |
|-----------|---------|----------------|-----------|-------------------------|
| `analytics_snapshots` rows `dashboard_bundle_v1` | **Database-derived materialized aggregate** | Per-user windowed summaries, hero metrics, recent-listen slots, **archive header strip inputs** (`archive_totals`, `ranges.all.summary` mapping) | Fresh only while no canonical `listens.played_at` is strictly **after** `body.as_of` (UTC); API exposes `snapshot_read` / `source` | BullMQ `windowed_aggregate` → `recomputeDashboardAnalyticsBundle`; best-effort enqueue after successful import/sync; `GET /api/analytics/summary` enqueues when snapshot missing/invalid/stale |
| `analytics_snapshots` rows `listen_fingerprint_v1` | **Database-derived aggregate** | `max(played_at)`, `count(*)` for polling/WebSocket refresh decisions | Same `played_at > as_of` probe as bundle | Written in same worker pass as bundle |
| Live SQL fallbacks | **Authoritative recompute on read** | Any snapshot miss/stale/invalid path | Always current | N/A — this is the correctness backstop |

**Operator caveat (documented in code):** staleness uses **newer** listens only; deletes/backfills that do not advance `max(played_at)` can leave a snapshot marked fresh while totals drift. The system already surfaces `snapshot_read` / `fingerprint_read_model` so clients never need to guess.

Redis in this repo today backs **BullMQ** (`@vs/queue`); it is **not** a general-purpose HTTP response cache.

---

## Reviewed cache candidates

### 1. Stats summaries (`GET /api/analytics/summary`, dashboard stats surfaces)

| Field | Value |
|-------|--------|
| **Freshness requirement** | User-visible charts should match canonical listens within the snapshot contract (tens of seconds to a few minutes stale is acceptable **only** when explicitly labeled via `source` + `snapshot_read`). |
| **Invalidation trigger** | New canonical listen with `played_at > as_of`; import/sync completion enqueue; explicit `windowed_aggregate` job. |
| **Expected performance gain** | **High** when bundle is fresh: avoids repeated heavy `GROUP BY` work (already realized). |
| **Pattern** | **DB-derived** (implemented). |
| **Ownership** | Worker (`apps/worker` analytics processor) + `@vs/db` recompute; web route enqueues on miss/stale. |

**Verdict:** **Keep and treat as the primary cache layer.** Do not move “truth” for totals/top lists to the browser or an unlabeled edge cache.

---

### 2. Archive group metadata (SSR strip: total plays, top artist, `firstListenAt`)

| Field | Value |
|-------|--------|
| **Freshness** | Same as stats summaries for strip values sourced from the bundle; `firstListenAt` from `archive_totals` when bundle fresh. |
| **Invalidation** | Identical to `dashboard_bundle_v1`. |
| **Performance gain** | **High** on archive first paint when `loadArchivePageShell` / `loadArchivePageData` skip `getDashboardListenSummaryArchivePageHeader` + `getEarliestListenPlayedAtForUser` (already the fast path). |
| **Pattern** | **DB-derived** via bundle (implemented). |

**Verdict:** **Prioritize keeping the bundle fresh** (queue health, enqueue after writes) over adding a second cache tier.

---

### 3. Archive keyset pages (`getArchiveListensPage`, `GET /api/analytics/archive-listens`, export ZIP batching)

| Field | Value |
|-------|--------|
| **Freshness** | Must track **new** listens immediately for default “newest first” archive UX; search/filter permutations multiply cache keys. |
| **Invalidation** | Essentially per-row or per-cursor; any scrobble invalidates “first page” semantics. |
| **Performance gain** | Medium in theory; **invalidation complexity and staleness risk dominate**. |
| **Pattern** | If ever revisited: **DB-first** (partial indexes, query shape) before Redis/page cache. |

**Verdict:** **Reject Redis or CDN caching of full archive JSON responses** for signed-in traffic. **Reject** misleading client-side persistent caches of pages without server fingerprint alignment.

---

### 4. Import status (list, latest, and detail)

Surfaces: `GET /api/imports` returns `{ latest, history }` (newest-first user-sourced jobs in one round-trip); `GET /api/imports/latest` uses `getLatestDashboardImportJobForUser` for dashboard polling; `GET /api/imports/[importId]` serves a single job row. All paths read **current** `import_jobs` rows from Postgres.

| Field | Value |
|-------|--------|
| **Freshness requirement** | Near-real-time stage and progress fields while a job is active; list views must reflect new jobs as soon as the row exists. |
| **Invalidation trigger** | Any insert/update on `import_jobs` for the user (stage transitions, checkpoint fields, terminal errors). |
| **Expected performance gain** | **Low** — bounded list (UI/API caps), indexed by `user_id` + newest-first ordering; not a heavy aggregate. |
| **Pattern** | Postgres as the only durable layer; **reject** extra TTL caches that could show a completed job as running. |

**Verdict:** **Reject** additional server caches (in-memory/Redis) unless profiling proves hot-spot contention; invalidation frequency would negate wins.

---

### 5. Export readiness / progress (`getExportJobByIdForUser`, `GET /api/export/listens/[id]`)

| Field | Value |
|-------|--------|
| **Freshness** | **Strict** — `itemsProcessed` / `itemsTotal` / `stage` must reflect worker writes; response already documents not to infer totals from BullMQ. |
| **Invalidation** | Continuous during job lifetime. |
| **Performance gain** | **Low** for typical single-row reads. |

**Verdict:** **Reject** caching beyond Postgres; **high risk** of fake precision if layers hide lag or expired artifacts.

---

### 6. Recent listens (`GET /api/analytics/recent-listens`)

| Field | Value |
|-------|--------|
| **Freshness** | Should align with dashboard “recent” expectations (same window semantics as stats). |
| **Invalidation** | Same as listens in window. |
| **Performance gain** | **Medium** if route reused **fresh** `dashboard_bundle_v1` slots (bundle already stores `recentListens` per range) instead of only live SQL — this is a **read-path consolidation**, not a new cache technology. |
| **Pattern** | Prefer **DB-derived** reuse of bundle with explicit `source` / `snapshot_read` parity to summary (future implementation). |

**Verdict:** **Do not add Redis.** Optional **P1** engineering: mirror the summary route’s snapshot preference and expose the same transparency fields.

---

### 7. Repeated lookup data (`GET /api/me`, user profile fields, process-scoped config)

| Field | Value |
|-------|--------|
| **Freshness requirement** | Profile and Last.fm credential flags on `GET /api/me` must match Postgres immediately after a successful `PATCH /api/me` (and any future profile mutation routes). |
| **Invalidation trigger** | Successful `updateUserProfileFields` (or equivalent) for that user; new session establishment does not relax freshness—clients re-fetch `me` after explicit profile saves. |
| **Expected performance gain** | **Low** for `getUserProfileFields` — single keyed read per request. |
| **Pattern** | Optional **in-request dedupe** (React `cache` / loader coalescing) if one HTTP request issues duplicate profile queries; **reject** cross-request Redis or in-memory TTL caches keyed only by `userId` without a write-through invalidation hook. |

**Process-scoped “reference” inputs (not user DB rows):** feature gating and deployment config come from `@vs/env` / `@vs/feature-flags` (e.g. `skipRedisQueues`) and are read at process lifetime, not per-user from the database. **Reject** treating them as HTTP response caches; if memoization is ever needed, it belongs at **startup / env load**, not as a substitute for user-specific freshness on `me`.

**Verdict:** **Reject** cross-request TTL caches for per-user profile rows; **reject** mis-applying “cache” language to env/flags without labeling them process-scoped and non-user-authoritative.

---

## Explicitly rejected (summary)

| Candidate | Why rejected |
|-----------|----------------|
| Authenticated **HTTP edge/CDN cache** for analytics JSON | Cannot expose freshness contract; violates explicit `snapshot_read` visibility. |
| **Redis JSON blobs** duplicating `dashboard_bundle_v1` | Second source of truth; harder invalidation than DB snapshot + existing probe. |
| **Client-only aggregates** (localStorage “stats”) | Conflicts with backend-as-source-of-truth for user-facing numbers. |
| **Archive page / cursor Redis cache** | Key explosion; staleness visible to users without a rigorous invalidation model. |
| **Import/export row micro-caches** | Low gain; high staleness risk relative to job churn. |

---

## Prioritized plan

| Priority | Item | Owner | Pattern | Notes |
|----------|------|-------|---------|-------|
| **P0** | Keep `dashboard_bundle_v1` + `listen_fingerprint_v1` healthy | Worker + SRE | DB-derived | Monitor queue lag, job failures; ensure post-import enqueue remains best-effort but observable. |
| **P0** | Preserve API transparency (`source`, `snapshot_read`, `fingerprint_read_model`) | Web API (`apps/web`) | Contract | Any new cache must not remove these fields or their meaning. |
| **P1** | Align `GET /api/analytics/recent-listens` with bundle read model when fresh | Web + `@vs/db` | DB-derived reuse | Reduces duplicate heavy reads; requires explicit response metadata (same discipline as summary). |
| **P1** | DB/query tuning for `getArchiveListensPage` hot paths | `@vs/db` | Indexes / explain | Prefer before any page-level cache (see VS-69 tooling references in repo). |
| **P2** | In-request dedupe only where double-fetch is proven | Web server loaders | In-memory (request-scoped) | No cross-user/shared TTL without evidence. |
| **P2** | Separate Redis cache namespace for **non-JSON** concerns (rate limits, idempotency keys) | Platform | Redis | Only if a ticket introduces such controls; **not** for dashboard bodies. |

---

## Invalidation strategy (single narrative)

1. **Write path:** Any pipeline that inserts canonical listens should continue to enqueue `windowed_aggregate` (or equivalent) so DB snapshots move forward with bounded lag.
2. **Read path:** If snapshot is missing, invalid, stale, or structurally wrong, **serve live SQL** and label the response — never silently blend.
3. **Deletes/backfills:** Treat snapshots as **best-effort** until a stricter probe exists; document in operator runbooks (already noted in read-models doc).
4. **Cross-tier:** If a future layer (CDN, edge) is introduced, it must be **disabled for authenticated analytics** or keyed with **opaque, server-issued ETags** tied to `as_of` / fingerprint — out of scope until measured need exists.

---

## Performance gain rubric (how estimates were classified)

| Label | Meaning |
|-------|---------|
| **High** | Avoids large aggregation or multiple heavy queries per request (already demonstrated for bundle-backed routes). |
| **Medium** | Saves repeated work within the same product area but not dominant latency without measurement. |
| **Low** | Single-row or already-cheap queries; caching overhead may exceed benefit. |

**Evidence (when quantitative claims are required):** use the web harness `npm run perf:baseline -w web` (`apps/web/scripts/performance-baseline.ts`), DB loader harness `npm run perf:baseline:db -w web`, recorded artifacts under `docs/performance-baseline/`, and narrative context in `docs/performance-audit-baseline.md`. Labels in this plan remain qualitative until a ticket binds numbers to those baselines.

---

## References (code anchors)

- Snapshot recompute + staleness: `packages/db/src/dashboardAnalyticsRecompute.ts` (`resolveDashboardAnalyticsBundleRead`).
- Summary API: `apps/web/src/app/api/analytics/summary/route.ts`.
- Archive SSR loaders: `apps/web/src/server/archive-page-data.ts`.
- Archive API: `apps/web/src/app/api/analytics/archive-listens/route.ts`.
- Fingerprint: `packages/db/src/listenSync.ts` (`getListenFingerprintForUser`).
- Import latest: `apps/web/src/app/api/imports/latest/route.ts` + `getLatestDashboardImportJobForUser` in `packages/db/src/importJobs.ts`.
- Export status: `apps/web/src/app/api/export/listens/[exportJobId]/route.ts`.
