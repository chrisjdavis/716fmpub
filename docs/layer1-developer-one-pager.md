# Layer 1 evidence — developer one-pager

716FM **Layer 1** is the offline path that turns canonical **`listens`** (and related rollups) into **durable, validated evidence rows** for downstream analytics and future “Layer 2+” features. Jobs run on the **analytics** BullMQ queue as `layer1_evidence_recompute`.

The **dashboard bundle** job (`windowed_aggregate` → `recomputeDashboardAnalyticsBundle`) refreshes `dashboard_bundle_v1`, window signals, and the listen fingerprint snapshot — **not** Layer 1 rows. Layer 1 is always scheduled through `enqueueLayer1EvidenceRecomputeForUser*` and executed in `runLayer1EvidenceRecomputeJob`.

## Lifecycle at a glance

| Topic | Contract |
| --- | --- |
| **Automatic triggers** | Import completion (`import_completed`), listen-derived churn (`listen_ingested` after bundle work or sync ingest), Core→Advanced (`advanced_upgrade`), and Advanced reconciliation sweeps (`nightly_reconciliation`). Every job carries a closed `enqueueReason` enum (`packages/queue/src/job-contracts.ts`). |
| **Advanced-only** | Product enqueue paths require **Advanced** `users.product_plan` (`requireAdvancedEntitlement`). Core accounts are skipped with a structured outcome — no “silent” Layer 1 work. |
| **`account_role` vs plan** | Staff **`account_role`** gates **admin APIs and surfaces** only. **Advanced AI / Layer 1** access follows **`product_plan`**, not role. A staff Core account does not gain Layer 1 via role alone. See [VS-71](./implementation-notes/VS-71-permissions-vs-entitlements.md). |
| **Manual / operator** | Staff `POST …/layer1-recompute` (`admin_manual`), non-prod CLI `--users` (override + `admin_manual`), and `--cursor-batch` (`internal_backfill`) are **admin / debug / backfill** paths — not the primary product lifecycle. |
| **Signal version + watermark** | `LAYER1_ACTIVE_SIGNAL_VERSION` (`@vs/domain`) vs `layer1_user_recompute_state.signal_version`; canonical input frontier vs `input_watermark` (`queryLayer1InputWatermarkForUser`). Together they drive **skip-if-fresh** and reconciliation selection so clients are not asked to trust stale evidence as new. |

Full narrative: [VS-92 TASK 9.1 — Layer 1 automation lifecycle](./implementation-notes/VS-92-task-9-1-layer1-automation-lifecycle.md).

## Prerequisites

| Requirement | Notes |
| --- | --- |
| **Postgres** | Migrated schema (`npm run db:migrate` from repo root). Evidence tables and runs are defined in migrations under `packages/db/migrations/`. |
| **Redis + worker** | `REDIS_URL` set; **`FEATURE_FLAGS` must not** set `skipRedisQueues: true`. The worker must be running so `analytics` queue consumers process jobs (`npm run dev:worker` or equivalent). |
| **`.env` at repo root** | The enqueue script loads the same env contract as other tooling (`dotenv` via root `package.json`). |

The root CLI **refuses production** deploy tier (`deployEnv === "production"`). Use dev/staging or run SQL/ops flows in prod under your own change control.

## Enqueue a recompute (from repo root)

Operator CLI only (`deployEnv !== "production"`). `--users` routes through `enqueueLayer1EvidenceRecomputeForUser` with **`internalEntitlementOverride`** (debug/backfill); `--cursor-batch` publishes `internal_backfill` cursor jobs without per-user entitlement at enqueue time.

```bash
npm run enqueue:layer1-recompute -- --users <uuid>[,uuid...]
```

Up to **200** UUIDs per job. Example:

```bash
npm run enqueue:layer1-recompute -- --users 00000000-0000-4000-8000-000000000001
```

**Cursor batch** (pages through `users.id` order, limit **1–500** per job):

```bash
npm run enqueue:layer1-recompute -- --cursor-batch --limit 50 --after start
npm run enqueue:layer1-recompute -- --cursor-batch --limit 100 --after <uuid>
```

Optional flags (see `apps/worker/scripts/enqueue-layer1-recompute.ts`): `--artist-limit <1-50>`, `--correlation-id <string>`.

Implementation entry: `enqueueLayer1EvidenceRecomputeExplicitUsers` / `enqueueLayer1EvidenceRecomputeUserCursorBatch` in `packages/queue/src/analytics-dashboard-enqueue.ts`.

## Where to look after a run

| What | Where |
| --- | --- |
| **Evidence rows** | `layer1_evidence_objects` (validated body + first-class eligibility columns). |
| **Job provenance** | `layer1_signal_runs` (`status`, `error_code`, timestamps). |
| **Pure calculators** | `packages/domain` — e.g. `listeningHistoryCoverageQuality.ts`, `listeningWindowComparison.ts`, `artistUserRelationshipSignals.ts`, `evidence/layer1EvidenceObject.ts`. |
| **Orchestration / upsert** | `packages/db/src/layer1EvidenceRecomputeJob.ts`, `layer1EvidenceObjectUpsert.ts`. |

Do **not** treat “run succeeded” alone as “every user/artist has evidence” — caps and insufficiency paths are normal. Parse failures must use `parseLayer1EvidenceObject` and respect `{ ok: false }`.

## Deeper reading (in-repo)

| Doc | Purpose |
| --- | --- |
| [VS-41 — integration boundaries](./implementation-notes/VS-41-ai-layer-1-integration-boundaries.md) | Where listens, rollups, queues, and web boundaries live; where to extend vs. fork. |
| [VS-56 — performance & failure modes](./performance/vs-56-layer1-performance-and-failure-modes.md) | Batch limits, play-row cap, logging, recovery, `UnrecoverableError` semantics. |
| [VS-57 — Layer 2+ consumption of Layer 1](./implementation-notes/VS-57-layer-2-plus-layer-1-evidence-consumption.md) | How higher layers must use (or not bypass) persisted evidence; freshness notes. |
| [VS-92 — Layer 1 automation lifecycle](./implementation-notes/VS-92-task-9-1-layer1-automation-lifecycle.md) | Triggers, Advanced gating, manual paths, signal version / input watermark. |

## CI

Regression coverage lives in `packages/db`, `packages/domain`, `packages/queue`, and `apps/worker` tests touched by the Layer 1 train. Run **`npm test`** from the repository root before merging substantive changes (same as `AGENTS.md`).
