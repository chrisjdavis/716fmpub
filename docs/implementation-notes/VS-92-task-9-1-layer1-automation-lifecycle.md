# VS-92 TASK 9.1 — Layer 1 automation lifecycle (technical reference)

Practical contract for **how Layer 1 evidence is scheduled, gated, and deduplicated** in the current stack. Layer 1 means durable `artist.user_relationship.v1` rows in `layer1_evidence_objects`, produced offline from canonical `listens` (rolling 30d window, bounded top artists). Use this note when extending Vector Sigma automation or designing Layer 2 readers.

## Separation of concerns

| Concern | Mechanism |
| --- | --- |
| **Dashboard bundle + window signals + listen fingerprint snapshot** | `windowed_aggregate` job → `recomputeDashboardAnalyticsBundle` (`packages/db/src/dashboardAnalyticsRecompute.ts`). **Does not** call `recomputeArtistUserRelationshipLayer1ForUser30dTop`. |
| **Layer 1 durable evidence** | BullMQ job `layer1_evidence_recompute` → `runLayer1EvidenceRecomputeJob` (`packages/db/src/layer1EvidenceRecomputeJob.ts`). **Only** this path (plus tests/scripts that invoke the same primitives) materializes / replaces `layer1_evidence_objects` for the signal family in scope. |

Product lifecycle code **enqueues** Layer 1 work through `enqueueLayer1EvidenceRecomputeForUser` / `enqueueLayer1EvidenceRecomputeForUserBestEffort` (`packages/db/src/layer1EvidenceRecomputeEnqueue.ts`), which applies entitlement, freshness, and queue coalescing before publishing to Redis.

## Automatic triggers (closed vocabulary)

Every published job carries `enqueueReason` from the enum in `packages/queue/src/job-contracts.ts` (`LAYER1_EVIDENCE_RECOMPUTE_ENQUEUE_REASON_CODES`). Automatic (non-operator) reasons used in production paths today:

| Reason | When it fires | Primary modules |
| --- | --- | --- |
| `import_completed` | After a user Last.fm import reaches `completed` (`enqueueLayer1AfterLastfmImportCompletion`); also when stats foundation repair runs (`ensureUserStatsFoundationJobsIfNeeded`). | `apps/worker/src/enqueueLayer1AfterLastfmImportCompletion.ts`, `apps/web/src/server/ensure-user-stats-foundation-jobs.ts` |
| `listen_ingested` | After `windowed_aggregate` finishes the dashboard bundle for a scoped user (worker chains best-effort enqueue); after meaningful canonical listen ingest on sync (`enqueueLayer1AfterMeaningfulListenIngestion`); when an Advanced user hits `GET /api/analytics/summary` and the handler best-effort enqueues refresh work. | `apps/worker/src/analyticsQueueProcessor.ts`, `apps/worker/src/enqueueLayer1AfterMeaningfulListenIngestion.ts`, `apps/web/src/app/api/analytics/summary/route.ts` |
| `advanced_upgrade` | Admin (or internal) flow moves a user **Core → Advanced** so Layer 1 can backfill for newly entitled accounts. | `packages/db/src/adminUserProductPlanLayer1Enqueue.ts` (called from admin product-plan mutation path) |
| `nightly_reconciliation` | Worker tick selects Advanced users whose persisted `layer1_user_recompute_state` is missing, stale, failed (past cooldown), or behind the **active signal version** / **input watermark** (see below), then enqueues bounded work per sweep. | `packages/db/src/layer1ScheduledReconciliation.ts`, `apps/worker/src/runLayer1ReconciliationTick.ts`; cadence/env: `LAYER1_RECONCILE_*` in `packages/env/src/schema.ts` |

`signal_version_changed` is a **reserved catalog reason** for explicit producer use when a deploy bumps computation contracts (same enum as audit vocabulary). Nightly reconciliation already picks up users whose stored `signal_version` ≠ `LAYER1_ACTIVE_SIGNAL_VERSION`, so routine drift is covered even without a dedicated `signal_version_changed` publisher on every ship.

## Advanced-only eligibility (product plan)

`enqueueLayer1EvidenceRecomputeForUser` loads `users.product_plan` and calls `requireAdvancedEntitlement` (`@vs/domain`). **Core plans never enqueue** Layer 1 jobs through the product path: the function returns `skipped_not_entitled` and does not publish to BullMQ.

**`account_role` vs product plan (explicit):**

- **`users.account_role`** (e.g. staff / admin / owner) controls **who may access admin surfaces and staff APIs** (`require-admin-server-session`, admin routes). It does **not** grant Layer 1 computation or Advanced AI reads by itself.
- **`users.product_plan`** (Core vs Advanced) controls **Advanced product entitlements**, including Layer 1 enqueue eligibility and Advanced-gated API/read contracts. See also [VS-71 — permissions vs entitlements](./VS-71-permissions-vs-entitlements.md).

Operator tooling may pass `internalEntitlementOverride: true` **only** on controlled paths (e.g. CLI `--users`, cursor backfill) to bypass the Advanced gate for debug/backfill; product HTTP handlers must not use this for normal users.

## Manual recompute: admin, debug, and backfill only

| Path | Role | Notes |
| --- | --- | --- |
| `POST /api/admin/users/:userId/layer1-recompute` | Staff admin API | Requires admin session. Target must be **Advanced** (`product_plan`); returns `403` with `layer1_admin_recompute_requires_advanced_plan` for Core. Uses `admin_manual` + `actorUserId` for audit. |
| `npm run enqueue:layer1-recompute -- --users …` | Operator CLI (non-production) | Per-user path uses `enqueueLayer1EvidenceRecomputeForUser` with `internalEntitlementOverride: true` and reason `admin_manual` (see `apps/worker/scripts/enqueue-layer1-recompute.ts`). |
| `npm run enqueue:layer1-recompute -- --cursor-batch …` | Operator paging / mass backfill | Publishes `user_cursor_batch` jobs with `enqueueReason: internal_backfill`. Cursor scope does **not** run per-user entitlement at enqueue time; treat as **internal backfill** with operational guardrails. |

Routine product behavior should rely on **automatic** reasons above, not on manual enqueue, except for incident response or deliberate backfills.

## Signal version and input watermark (freshness, no fake precision)

**Signal version:** `LAYER1_ACTIVE_SIGNAL_VERSION` in `packages/domain/src/evidence/layer1ActiveSignalVersion.ts` is the single active composite string (`signal_kind` + definition version + evidence schema version). It is mirrored on `layer1_user_recompute_state.signal_version` after successful runs. Any mismatch means persisted state is **stale** relative to current code contracts until a successful recompute updates it.

**Input watermark:** `queryLayer1InputWatermarkForUser` (`packages/db/src/layer1UserRecomputeState.ts`) defines the deterministic “input frontier” as the greatest timestamp among:

- `max(listens.played_at)`
- `max(listens.created_at)`
- `max(import_jobs.updated_at)` for `stage = 'completed'`

`layer1_user_recompute_state.input_watermark` stores the watermark observed after the last successful materialization. `shouldSkipLayer1UserEvidenceRecompute` compares persisted `(signal_version, input_watermark, status)` to the current watermark and active version so duplicate publishes **short-circuit** (`skipped_already_fresh` at enqueue; worker may still no-op per user inside `runLayer1EvidenceRecomputeJob`).

**Failure visibility:** statuses include `failed`, `failed_exhausted` (after consecutive failure budget — VS-84), `stale`, `never_computed`. Operators should consult `layer1_user_recompute_state`, `layer1_signal_runs`, and structured worker logs — not infer freshness from HTTP 200 alone.

## Related code and docs

- One-pager: `docs/layer1-developer-one-pager.md`
- Entry-point audit (kept in sync with this lifecycle): `docs/implementation-notes/VS-72-task-1-1-layer1-recompute-entry-points.md`
- Integration map: `docs/implementation-notes/VS-41-ai-layer-1-integration-boundaries.md`
- Performance / caps: `docs/performance/vs-56-layer1-performance-and-failure-modes.md`
- Layer 2 read contract: `docs/implementation-notes/VS-57-layer-2-plus-layer-1-evidence-consumption.md`
