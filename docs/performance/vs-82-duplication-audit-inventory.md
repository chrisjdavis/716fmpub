# VS-82 — Duplication audit inventory (TASK 7.1)

This document closes the reviewer loop on **scope versus ticket wording** and records **what was consolidated**, **what was intentionally out of scope for this PR**, and **how performance is measured** for the paths we touched.

## Scope decision (hotspots first)

The ticket asks for a broad audit (handlers, workers, selectors, components). This iteration **prioritized correctness-critical duplication** where drift would silently corrupt contracts: shared PostgreSQL row coercion for `timestamptz`, and a **second copy of the listen fingerprint aggregate SQL** in the live read path. Broader UI memoization, selector libraries, and cross-package deduplication remain **tracked below** for follow-up work unless PM re-prioritizes.

## Consolidated in VS-82 (shipped)

| Area | Before | After |
|------|--------|--------|
| `timestamptz` → JSON-safe ISO | Separate helpers in `dashboardAnalytics.ts` and `listenFingerprintReadModel.ts` | `packages/db/src/pgTimestamptz.ts` (`pgTimestamptzToIsoString`, `pgTimestamptzToIsoOrNull`) |
| Listen fingerprint live aggregate | `queryListenFingerprintLive` duplicated SQL + mapping in `listenSync.ts` | `getListenFingerprintForUser` calls `queryListenFingerprintAggregateForUser` |
| Archive filter unions | Local string unions in `archive-browser.tsx` | `DashboardAnalyticsRange`, `ArchiveListenSourceFilter`, `ArchiveListenTypeFilter` from `@vs/db` |

## Measurement contract (`npm run bench:vs82 -w @vs/db`)

- **What we record:** Median wall time for two **critical server paths** after consolidation: `queryListenFingerprintAggregateForUser` and first-page `getArchiveListensPage`, on a fixed PGlite fixture (see script header).
- **What we do not claim:** A checked-in JSON snapshot is **not** a before/after proof of CPU delta for the fingerprint merge, because the live API still performs **one** aggregate query per fingerprint read; the win is **single implementation** (no drift), not halving round-trips.
- **Regression use:** Re-run the bench on the same machine class and compare medians to `packages/db/perf/vs82-redundant-path-timings.json` when touching those code paths.

## Design system note (archive browser)

VS-82 edits to `archive-browser.tsx` were **TypeScript contract alignment only** (no layout, tokens, or copy changes). Workspace `.cursor/skills/totally-rad/SKILL.md` states it applies when the user explicitly requests Nothing-style design; it does **not** auto-apply to generic UI tasks. Any future **visual** change on that surface should follow the skill and reference it in the PR.

## Remaining candidates (not fixed here)

| Location / pattern | Notes |
|--------------------|--------|
| `getListenSyncSummaryForUser` (`listenSync.ts`) | Uses `String(...)` on timestamp columns instead of `pgTimestamptz*`; consider aligning if we want one coercion story for all sync summaries. |
| `getListenSyncFromUnixBound` | Separate `max(l.played_at)` usage for epoch bound; different shape than fingerprint aggregate—evaluate whether sharing helpers buys clarity. |
| Dashboard hero / timeline mappers | `dashboardAnalytics.ts` still contains range-specific logic; no duplicate second implementation found in this pass. |
| Client `useMemo` / virtual rows | `archive-browser.tsx` + `archive-flat-rows.ts` already memoize flat rows; no redundant selector layer identified. |
| Workers / `apps/worker` | No duplicate fingerprint aggregate found; export zip uses `getArchiveListensPage` as single source. |

## Follow-up ticket suggestion

If product wants full **TASK 7.1** coverage: open a child issue for “VS-82b — client/worker duplication sweep” with acceptance criteria tied to this inventory table.
