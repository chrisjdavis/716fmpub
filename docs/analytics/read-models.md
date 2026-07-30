# Analytics read models

Precomputed aggregates live in `analytics_snapshots` (`user_id`, `kind`, `body` JSONB). Each kind documents its contract in `@vs/db` source; this note lists **candidates**, **freshness**, and **write paths**.

## Implemented kinds

| Kind | Purpose | Freshness rule | Written by |
|------|---------|----------------|------------|
| `dashboard_bundle_v1` | Windowed listen summaries, hero metrics, recent listens, archive totals strip | Stale when any canonical `listens.played_at` is **strictly greater** than `body.as_of` (UTC). | BullMQ `analytics` queue job `windowed_aggregate` → `recomputeDashboardAnalyticsBundle` (`apps/worker/src/analyticsQueueProcessor.ts`). |
| `listen_fingerprint_v1` | `max(played_at)` + `count(*)` for the dashboard HTTP/WebSocket refresh fingerprint | Same `played_at > body.as_of` probe as the dashboard bundle. | Same `windowed_aggregate` pass as the bundle (immediately after `dashboard_bundle_v1` upsert in `recomputeDashboardAnalyticsBundle`). |

**Operator caveat (deletes / backfills):** the staleness probe only looks at **newer** listens than `as_of`. Rows can read “fresh” while historical totals changed if `max(played_at)` did not move forward. Treat snapshots as best-effort; live SQL remains the fallback authority.

## Read paths

- Dashboard bundle: `resolveDashboardAnalyticsBundleRead` → live `getDashboardListenSummary` / related when not fresh.
- Listen fingerprint: `getListenFingerprintForUser` → prefers fresh `listen_fingerprint_v1`, else one live aggregate over `listens`. Responses include `fingerprint_read_model`: `snapshot_fresh` | `canonical_listens` (`GET /api/me/listen-fingerprint`).

## Keeping data fresh after imports and sync

1. **Successful Last.fm import / catch-up** — `runQueuedLastfmImport` calls `enqueueDashboardAnalyticsAfterImport` (`enqueueDashboardBundleAnalyticsForUserBestEffort`), which coalesces a `windowed_aggregate` job for that user.
2. **Stale bundle on demand** — `GET /api/analytics/summary` enqueues the same job best-effort when the bundle is missing, invalid, or stale (parallel to live reads).

Because `listen_fingerprint_v1` is written in the **same** worker handler as `dashboard_bundle_v1`, fingerprint snapshots track the same completion signal: import/sync finishes → job runs → both kinds update together.

## Candidate / deferred read models

These remain **live SQL** today; promote them only when measured pain appears and freshness rules are explicit:

| Area | Current source | Notes |
|------|----------------|-------|
| Stats summaries / top artists / albums / tracks | `getDashboardListenSummary` (and bundle slots) | Heavy `GROUP BY` paths; already covered by `dashboard_bundle_v1` for dashboard-sized windows. |
| Replay / session-style aggregates | Not a first-class API in this repo | If added, define a dedicated `kind`, schema version, and the same `played_at > as_of` (or tighter) rule. |
| Archive keyset pages | `getArchiveListensPage` | Row-level reads; precompute rarely justified unless we add coarse invalidation + cache keys. |

## Measurements

From the repository root, PGlite micro-benchmark (median wall time, not production Postgres):

```bash
npm run bench:vs70 -w @vs/db
```

Output is written to `packages/db/perf/vs70-listen-fingerprint-read-model-timings.json` and compares the legacy single-statement aggregate against the snapshot read + staleness `exists` probe for the same fixture scale.
