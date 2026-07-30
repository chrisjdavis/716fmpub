# VS-72 TASK 1.1 — Layer 1 recompute entry points (audit)

**Signal family in scope:** `artist.user_relationship.v1` durable evidence in `layer1_evidence_objects`, produced from canonical `listens` (rolling 30d window, top artists by play volume). Domain builder: `buildArtistUserRelationshipLayer1Evidence`; DB writer: `recomputeArtistUserRelationshipLayer1ForUser30dTop` → `upsertLayer1EvidenceObject`.

**Lifecycle note:** Layer 1 is **not** embedded in `recomputeDashboardAnalyticsBundle`. After the bundle path runs, product code may **enqueue** `layer1_evidence_recompute` separately. See [VS-92](./VS-92-task-9-1-layer1-automation-lifecycle.md).

## 1. Paths that materialize Layer 1 evidence (SQL upserts)

| # | Trigger | Callable / contract | Runs `recomputeArtistUserRelationshipLayer1ForUser30dTop`? | Audience / guard |
|---|---------|---------------------|--------------------------------------------------------------|-------------------|
| A | Analytics BullMQ job `layer1_evidence_recompute` | `apps/worker/src/analyticsQueueProcessor.ts` → `runLayer1EvidenceRecomputeJob` (`packages/db/src/layer1EvidenceRecomputeJob.ts`) | Yes; per user in scope; passes `layer1SignalRunId` from `layer1_signal_runs` | **Worker-internal.** Enqueue via `enqueueLayer1EvidenceRecomputeExplicitUsers` / `enqueueLayer1EvidenceRecomputeUserCursorBatch` / `enqueueLayer1EvidenceRecomputeForUser` (`packages/queue`, `packages/db`). |
| B | Automated tests | PGlite / Vitest: `layer1EvidenceRecomputeJob.integration.test.ts`, `artistUserRelationshipLayer1Recompute.integration.test.ts`, etc. | Direct or via job | **Internal-only.** |
| C | Operator CLI | `npm run enqueue:layer1-recompute` → `apps/worker/scripts/enqueue-layer1-recompute.ts` | Enqueues path A (`admin_manual` + entitlement override per `--users`, or `internal_backfill` cursor batch) | **Internal / operator shell.** Refuses `deployEnv === "production"`; requires Redis queues enabled. |

## 2. `windowed_aggregate` (dashboard bundle) — adjacent but not inline Layer 1

`windowed_aggregate` runs `recomputeDashboardAnalyticsBundle` only (`dashboard_bundle_v1`, `user_window_signals_v1`, listen fingerprint snapshot). **It does not** call `recomputeArtistUserRelationshipLayer1ForUser30dTop`.

The worker then calls `enqueueLayer1EvidenceRecomputeForUserBestEffort` with reason **`listen_ingested`** for the same `userId` (`apps/worker/src/analyticsQueueProcessor.ts`), so listen-driven freshness still schedules Layer 1 on a **separate** job with its own provenance row when that enqueue succeeds.

## 3. What enqueues Layer 1 without materializing it in the web thread

These paths call `enqueueLayer1EvidenceRecomputeForUserBestEffort` (or the non–best-effort variant in tests/scripts), which may return `skipped_already_fresh`, `skipped_not_entitled`, etc. **No** `apps/web` route invokes `recomputeArtistUserRelationshipLayer1ForUser30dTop` directly.

- **Post-import:** `enqueueLayer1AfterLastfmImportCompletion` → `import_completed`.
- **Listen sync ingest:** `enqueueLayer1AfterMeaningfulListenIngestion` → `listen_ingested`.
- **Stats foundation repair:** `ensureUserStatsFoundationJobsIfNeeded` → `import_completed` after dashboard enqueue.
- **Analytics summary (Advanced):** `GET /api/analytics/summary` → best-effort `listen_ingested` alongside dashboard bundle enqueue.
- **Core → Advanced:** `enqueueLayer1EvidenceRecomputeForAdminCoreToAdvancedUpgradeBestEffort` → `advanced_upgrade`.
- **Reconciliation tick:** `tryRunLayer1ReconciliationSweep` → `nightly_reconciliation` for selected Advanced users.
- **Staff admin:** `POST /api/admin/users/:userId/layer1-recompute` → `admin_manual` (Advanced target only).

## 4. Inline recompute during HTTP request threads?

**No.** Layer 1 SQL runs in the **analytics worker** when processing `layer1_evidence_recompute`, or in tests/scripts that call the job primitive directly.

## 5. Primitives to keep central

- **Enqueue gate:** `enqueueLayer1EvidenceRecomputeForUser` (`packages/db/src/layer1EvidenceRecomputeEnqueue.ts`) — Advanced entitlement, input watermark / signal version short-circuit, `layer1_user_recompute_state` queue transitions, then BullMQ publish with stable per-user `jobId`.
- **Orchestrated batch:** `runLayer1EvidenceRecomputeJob` (opens `layer1_signal_runs`, per-user loop, worker-side skip-if-fresh).
- **Per-user core:** `recomputeArtistUserRelationshipLayer1ForUser30dTop` (`packages/db/src/artistUserRelationshipLayer1Recompute.ts`).

## 6. References

- `docs/layer1-developer-one-pager.md`
- `docs/implementation-notes/VS-92-task-9-1-layer1-automation-lifecycle.md`
- `docs/implementation-notes/VS-41-ai-layer-1-integration-boundaries.md`
- `docs/performance/vs-56-layer1-performance-and-failure-modes.md`
