# VS-66 — API route performance audit

This document reviews every Next.js App Router handler under `apps/web/src/app/api/**/route.ts` for request cost, payload shape, query fan-out, redundant work, and blocking behavior. Classification: **product** (session or browser-facing account flows), **internal** (Bearer-secret operator/integration paths).

Related server work that is not an HTTP route but drives the same SQL patterns: `loadDashboardPageData` in `apps/web/src/server/dashboard-page-data.ts` (dashboard RSC). It is referenced where it amplifies cost beyond the API surface.

---

## Cross-cutting cost: authenticated routes

`withApiSession` (`apps/web/src/server/api/require-session.ts`) runs on every cookie-authenticated API request before the handler body:

- `validateSession` → Postgres (session lookup / rotation rules).
- Unsafe methods: trusted-transport guard + CSRF double-submit verification (extra async work and sometimes extra DB reads for denied logout CSRF paths).

**Implication:** “cheap” handlers such as `GET /api/me/listen-fingerprint` still pay session validation on every poll. Remediation options belong in a follow-up ticket (session caching policy, edge session hints, or consolidating polls)—listed in the remediation table below.

---

## Route-by-route findings

### Product — analytics

| Route | Methods | DB / work | Payload / over-fetch | Blocking / redundancy |
|-------|---------|-----------|------------------------|------------------------|
| `/api/analytics/summary` | GET | **High (fallback).** `resolveDashboardAnalyticsBundleRead`: (1) load full `dashboard_bundle_v1` JSON from `analytics_snapshots`, (2) `exists` freshness probe against `listens`. If not fresh: `getDashboardListenSummary` runs **four** parallel heavy aggregations (count + top artists CTE + top tracks + top albums) over `listens` + joins to `tracks` / `artists` / `albums` / `raw_scrobbles`. | Snapshot path returns only the requested `range` slice (good). Fallback computes full summary for one range including top lists the client may not need if it only wanted totals. | **Advanced plan only (VS-62):** Core accounts get `403` with `advanced_entitlement_required`. Stale/missing snapshot path repeats snapshot read + live SQL; no deferral. |
| `/api/analytics/window-total` | GET | **Canonical SQL only** — `readCachedCanonicalDashboardListenSummary` → `total_scrobbles` (+ read-cache telemetry). Does **not** read `dashboard_bundle_v1`. | Minimal JSON; Core-safe tape counts without snapshot row. | No bundle warm-enqueue; same bounded TTL read-cache family as summary fallback SQL. |
| `/api/analytics/recent-listens` | GET | **Medium.** Single large `SELECT` with joins (same family as archive/recent in `packages/db/src/dashboardAnalytics.ts`). | Default limit 50, max 100; returns display-oriented columns (cover URL, MBID)—appropriate for UI but wide rows. | None beyond query latency. |
| `/api/analytics/archive-listens` | GET | **Medium–high.** Keyset page over canonical listens with optional `ILIKE`-style substring filters and `import_jobs` join for provenance (`getArchiveListensPage`). Cost scales with library size and `q` selectivity. | Capped at 100 rows per request (good). | Client-driven pagination only; worst case many sequential pages (UX pattern, not a single-request bug). |
| `/api/public/analytics/*` | GET | Same SQL families as the private archive/window/summary routes when `listening_history_public` is on; **404** otherwise. Read-only (no recompute enqueue). | Same caps/sanitization as private counterparts. | Edge allowlisted; sole-owner resolved server-side. |

**Redundant calculations (cross-route):** If the UI (or future features) calls `summary` and `recent-listens` separately without a fresh bundle, both scan overlapping listen windows with similar joins. Prefer a single bundle read or server-composed responses when both are needed for the same view.

---

### Product — account / session

| Route | Methods | DB / work | Payload / over-fetch | Blocking / redundancy |
|-------|---------|-----------|------------------------|------------------------|
| `/api/auth/login` | POST | User lookup, optional dummy `hashPassword` on miss, `verifyPassword`, session invalidation + insert, audit event. | Minimal JSON. | Argon2/password verify is intentionally CPU-bound on the request thread. |
| `/api/auth/logout` | POST | Session destroy + audit; extra user lookup when CSRF invalid. | Minimal. | None unusual. |
| `/api/auth/setup` | POST | Transaction: insert user, invalidate other sessions, new session. | Minimal. | Password hashing on thread (expected). |
| `/api/auth/recovery/request` | POST | Lookup + `issuePasswordRecoveryToken` **or** dummy hash. | Constant body (good for enumeration resistance). | Dummy hash mirrors login cost (intentional). |
| `/api/auth/recovery/confirm` | POST | Token consume + password hash + password update + session delete. | Minimal. | Password hashing on thread (expected). |
| `/api/auth/verify-email` | POST | Row-locked email verification token consume + idempotent `email_verified_at` set on `users`. | JSON includes `newlyVerified` and `email` on success; failures return explicit `code`. | Single transaction; invalid/expired/replayed tokens rejected without marking verified. |
| `/api/auth/verify-email-change` | POST | Row-locked `email_change_tokens` consume + `users.email` update with duplicate check under lock; sets `email_verified_at` when the new address is confirmed. | JSON `email` on success; explicit failure `code` values. | Conflict with another account’s email returns `409` without consuming the token. |
| `/api/me` | GET | `getUserProfileFields` after session validation. | Small JSON; includes `emailVerified` from session join; masks secrets as booleans only. | None. |
| `/api/me` | PATCH | Profile update, audit, **second** `getUserProfileFields` read to shape response. | N/A | Re-read could be merged with `UPDATE … RETURNING` in a future optimization (minor). |
| `/api/me/step-up` | POST | Password hash fetch + verify + `issueStepUpToken`. | Returns raw step-up token (required contract). | Crypto-bound verify. |
| `/api/me/listen-realtime` | GET | No DB when JWT secret configured; issues short-lived token. | Small JSON. | None. |
| `/api/me/listen-fingerprint` | GET | **Medium per poll.** `select max(played_at), count(*) from listens where user_id = …` (full user scope, no range). | Tiny JSON. | Called on an interval (`LISTEN_FINGERPRINT_POLL_MS` = 20s) from `dashboard-listen-fingerprint-poller.tsx`; each hit pays **full session gate** + aggregate over all listens. High churn libraries: consider approximate counts, materialized fingerprints, or tying refresh to NOTIFY-only when realtime is enabled. |
| `/api/me/resend-verification` | POST | `issueEmailVerificationToken` + transactional mail send when configured. | JSON dispatch status only (no token). | Rate-limited (`sensitive_post` bucket). |
| `/api/me/email-change/request` | POST | Verified-email gate; duplicate `users.email` check; step-up consume + `issueEmailChangeToken` in one transaction; transactional sends to new address (verification) and current address (notice). | JSON includes dispatch statuses and token expiry (no raw token). | Rate-limited (`sensitive_post` bucket). |
| `/api/me/listen-data` | POST | Step-up gated `purgeUserListenData` (large transactional delete work). | Response includes deletion counts. | **Must remain synchronous** for correctness and user confirmation; document as known long-running mutation (operator timeouts may apply). |

---

### Product — guided onboarding

| Route | Methods | DB / work | Payload / over-fetch | Blocking / redundancy |
|-------|---------|-----------|------------------------|------------------------|
| `/api/onboarding/complete` | POST | Marks guided onboarding finished after import progress thresholds. | Small JSON. | None unusual. |
| `/api/onboarding/defer` | POST | Sets deferral timestamp so dashboard is reachable without completing setup. | Small JSON. | None unusual. |
| `/api/onboarding/import/start` | POST | Same enqueue path as `POST /api/imports` (idempotent when a job is already active). | Small JSON. | Same BullMQ `queue.close()` pattern as imports. |
| `/api/onboarding/import/status` | GET | Syncs onboarding from latest user import + listen counts; small read set. | Small JSON. | Polled from onboarding UI while import runs. |
| `/api/onboarding/lastfm/configure` | POST | Profile write for Last.fm username + API key; onboarding state bump. | Small JSON. | Email verification gate matches imports. |
| `/api/onboarding/lastfm/validate` | POST | `lookupLastfmUsername` against Last.fm with user-supplied or stored credentials. | Small JSON. | External HTTP to Last.fm provider. |
| `/api/onboarding/state` | GET | Reads onboarding row, profile booleans, latest user import bucket, listen count. | Small JSON. | Called on onboarding wizard load / refresh. |

---

### Product — imports

| Route | Methods | DB / work | Payload / over-fetch | Blocking / redundancy |
|-------|---------|-----------|------------------------|------------------------|
| `/api/imports` | GET | Single query for **all** `import_jobs` for user (`source = 'user'`), ordered newest-first. | Returns `latest` plus **full** `history` array—no pagination. | Row count bounded by practical use but unbounded by schema; long account history = large JSON and higher parse cost on the client. |
| `/api/imports` | POST | Concurrency checks, `createImportJob`, BullMQ enqueue, `queue.close()` per request. | Small. | **Synchronous Redis/BullMQ** `enqueue` + **explicit `queue.close()`** on every POST adds latency vs a shared queue client (tradeoff: isolation vs connection churn). |
| `/api/imports/latest` | GET | Single-row “latest job” read. | Small. | None. |
| `/api/imports/[importId]` | GET | Single job by id + user. | Small. | None. |

**Redundancy note:** Dashboard code paths may touch both `GET /api/imports/latest` (client polling in `dashboard-import-live.tsx`) and `GET /api/imports` if both are used in the same flow—worth consolidating in a future UX pass.

---

### Product — export

| Route | Methods | DB / work | Payload / over-fetch | Blocking / redundancy |
|-------|---------|-----------|------------------------|------------------------|
| `/api/export/listens` | POST | Same pattern as imports: active job count, insert job, BullMQ enqueue + `setExportJobBullmqJobId`, `queue.close()`. | Small. | Same synchronous queue client lifecycle as imports. |
| `/api/export/listens/[exportJobId]` | GET | Single export job row + `computeListenExportArtifactAccess` (pure). | JSON includes a long `statusNote` string every poll (extra bytes; low severity). | Polling-driven traffic; note is static documentation duplicated in every response. |
| `/api/export/listens/[exportJobId]/download` | GET | Job row + token compare + `stat` + file stream. | Streams ZIP (expected large payload). | **Blocks** on disk read for the lifetime of the download (expected for streaming). |

---

### Internal (operator / integration)

| Route | Methods | DB / work | Payload / over-fetch | Blocking / redundancy |
|-------|---------|-----------|------------------------|------------------------|
| `/api/internal/security/audit-events` | GET | `listSecurityAuditEvents` (limit clamped server-side to **500** in `@vs/db`). | Full `metadata` json per row—appropriate for security tooling; cap already prevents unbounded rows. | Low risk. |
| `/api/internal/analytics/dashboard-default-snapshot` | POST | Upsert `analytics_snapshots` with arbitrary JSON `body` from caller. | Request/response size depends on operator payload (large JSON bodies are possible). | Writes can be heavy JSON validation / IO; acceptable for internal path. |
| `/api/internal/cache/invalidate-user-read-cache` | POST | Clears in-process user-scoped TTL read caches for `{ user_id }` (worker → web). | Tiny JSON body; Bearer-secret gated like other internal routes. | Low risk; best-effort from worker when `VS_WEB_INTERNAL_ORIGIN` / `VS_PUBLIC_APP_ORIGIN` + secret are configured. |
| `/api/internal/onboarding/notify-import-ready` | POST | Sends the one-shot onboarding “import + stats ready” email for `{ user_id }` when processing is complete (worker → web, also best-effort from onboarding state reads). | Tiny JSON body; Bearer-secret gated; idempotent via `users.onboarding_import_ready_email_sent_at`. | Low risk; depends on transactional mailer + `publicAppOrigin` being configured. |

---

## Non-route hotspot (dashboard SSR)

`loadDashboardPageData` (when no fresh `dashboard_bundle_v1` snapshot) runs `Promise.all` including **two** `getDashboardListenSummary` calls (selected range and `"all"`) plus `getDashboardRecentListens`, `getDashboardHeroWindowMetrics` (two queries internally for bounded ranges), and `getEarliestListenPlayedAtForUser`. Each `getDashboardListenSummary` issues **four** SQL statements in parallel—so the initial dashboard render can reach on the order of **ten** heavy statements in one navigation. This is the dominant server-side cost for “slow dashboard” reports and should stay aligned with bundle snapshot freshness work.

---

## Prioritized remediation list

| Priority | Item | Symptom / risk | Suggested direction |
|----------|------|----------------|---------------------|
| **P0** | Stale or missing `dashboard_bundle_v1` + `/api/analytics/summary` fallback | Slow summary API and redundant CPU/IO vs snapshot path | Keep snapshots fresh (worker frequency), add metrics on `snapshot_read.status`, consider lighter “totals-only” API if UI splits concerns. |
| **P1** | `GET /api/me/listen-fingerprint` under session + aggregate | Steady background load on active dashboards | Reuse realtime push exclusively when healthy; narrow SQL (approximate fingerprint, indexed partial aggregates, or NOTIFY-driven invalidation without `count(*)`). |
| **P1** | Double `getDashboardListenSummary` in `loadDashboardPageData` | Cold dashboard SSR latency | Derive archive header stats from one `"all"` summary pass or cache subfields in bundle recompute. |
| **P2** | `GET /api/imports` unbounded history | Large JSON and memory on long-lived accounts | Pagination or `limit` query param with stable ordering; split “latest + small history tail”. |
| **P2** | BullMQ `create*Queue` + `queue.close()` per enqueue on imports/export POST | Extra Redis round-trips and connection setup | Shared queue singleton or pooled connections (careful with serverless lifetimes). |
| **P3** | `/api/export/listens/[exportJobId]` static `statusNote` on every poll | Minor bandwidth | Move static guidance to docs or a `?include=help` flag. |
| **P3** | `PATCH /api/me` second profile read | Extra round trip | `UPDATE … RETURNING` profile fields in `@vs/db`. |
| **P4** | Archive / recent queries with `q` filter | Seq scans if indexes missing | Verify btree/trigram indexes for text filters in migrations (separate perf ticket). |

---

## Acceptance mapping

- **Every user-facing route reviewed:** All `route.ts` files under `apps/web/src/app/api` are covered above; internal routes are labeled separately.
- **Repeated / redundant calculations:** `getDashboardListenSummary` fan-out; double summary in `loadDashboardPageData`; overlapping joins between summary/recent/archive when bundle absent.
- **Over-fetching fields/rows:** `GET /api/imports` full history; summary fallback always includes top lists; export status long static note.
- **Blocking / deferrable work:** Purge and export download are legitimately synchronous; queue client lifecycle and fingerprint aggregate are deferral/optimization candidates.
- **Prioritized remediation:** Table above (P0–P4).

---

## Machine-readable route inventory

The following list is consumed by `apps/web/src/server/api/api-route-audit-doc-coverage.test.ts` to ensure new routes are added to this audit.

<!-- monitored-api-route-paths
/api/analytics/archive-listens
/api/analytics/recent-listens
/api/analytics/summary
/api/analytics/window-total
/api/auth/login
/api/auth/logout
/api/auth/recovery/confirm
/api/auth/recovery/request
/api/auth/setup
/api/auth/verify-email
/api/auth/verify-email-change
/api/export/listens
/api/export/listens/[exportJobId]
/api/export/listens/[exportJobId]/download
/api/imports
/api/imports/[importId]
/api/imports/latest
/api/internal/analytics/dashboard-default-snapshot
/api/internal/cache/invalidate-user-read-cache
/api/internal/onboarding/notify-import-ready
/api/internal/security/audit-events
/api/me
/api/me/email-change/request
/api/me/listen-data
/api/me/listen-fingerprint
/api/me/listen-realtime
/api/me/resend-verification
/api/me/step-up
/api/onboarding/complete
/api/onboarding/defer
/api/onboarding/import/start
/api/onboarding/import/status
/api/onboarding/lastfm/configure
/api/onboarding/lastfm/validate
/api/onboarding/state
/api/public/analytics/archive-listens
/api/public/analytics/summary
/api/public/analytics/window-total
-->
