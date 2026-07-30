# VS-81 — Route transitions and refresh behavior

## Changes (summary)

1. **Archive first paint** — `/dashboard/archive` now uses `loadArchivePageData` so the default-filter first page of listens ships with the RSC payload. The client no longer issues an immediate duplicate `GET /api/analytics/archive-listens` on mount for the same default keyset (all sources, all time, tracks, empty query).
2. **Listen fingerprint / realtime coalescer** — `router.refresh()` runs only when the active pathname is stats (`/dashboard`), archive, or imports. Export and settings no longer take a full RSC refresh when background listen invalidation fires while the user is on those screens.
3. **Primary nav** — Dashboard `Link`s set `prefetch` so soft navigations can warm segment payloads from the tab bar.

## Before / after (observations)

| Scenario | Before | After |
|----------|--------|-------|
| Open Archive (default filters) | RSC shell + client list fetch | Single RSC load includes first list page; no extra list fetch until filters change |
| Stay on Settings with music playing | Coalesced invalidation → `router.refresh()` → full dashboard tree revalidation | Invalidation signals ignored for refresh on that surface |
| Tab between Archive ↔ Stats | Each visit refetched list client-side after shell | Archive list defaults hydrate from RSC; filter changes still use the API |

## Timings (local dev, indicative)

Recorded via existing server perf helpers / manual navigation (2026-04-16, local workspace):

- **`loadArchivePageData`** (DB-heavy path without a fresh bundle): ~24 ms median server block in prior baseline (`docs/performance-audit-baseline.md`); replacing shell-only + client fetch removes **one** round trip to `/api/analytics/archive-listens` (~RTT + JSON parse) from the critical path on first paint.
- **Client**: DevTools Network shows **zero** `archive-listens` XHR on archive load with default filters after this change (filter-driven loads still appear as expected).

Re-run `node apps/web/scripts/performance-db-baseline.ts` (with a configured DB) to refresh absolute server timings for your environment.
