# Layer 1 signal automation — operator runbook (limited beta)

Short guide for **diagnosing import / listen data vs. Layer 1 evidence** during the beta. Layer 1 is the offline job that materializes durable `artist.user_relationship.v1` rows in Postgres (`layer1_evidence_objects`), driven by BullMQ job `layer1_evidence_recompute` on the **`analytics`** queue. **Postgres + worker logs + run tables are the source of truth** — do not infer freshness from the dashboard alone.

**Deeper references:** [Layer 1 developer one-pager](../layer1-developer-one-pager.md), [VS-92 lifecycle](../implementation-notes/VS-92-task-9-1-layer1-automation-lifecycle.md), [VS-56 performance & failure modes](../performance/vs-56-layer1-performance-and-failure-modes.md).

---

## Preconditions (sanity)

1. **Redis + worker** running with `REDIS_URL` set; `FEATURE_FLAGS` must **not** set `skipRedisQueues: true`.
2. **Migrations applied** (`npm run db:migrate` from repo root when schema changes).
3. **Product path is Advanced-only:** `users.product_plan` must be **Advanced** for automatic Layer 1 enqueue. Core accounts are intentionally skipped (`skipped_not_entitled`) — staff role does **not** substitute for Advanced (see [VS-71](../implementation-notes/VS-71-permissions-vs-entitlements.md)).

---

## 1. Inspect Layer 1 state for a user

Replace `$USER_ID` with the user’s UUID everywhere below.

### 1.1 Entitlement

```sql
select id, product_plan, account_role
  from users
 where id = $USER_ID::uuid;
```

If `product_plan` is not **Advanced**, routine automation will not enqueue Layer 1; evidence may be missing or stale until the account is Advanced (or you use controlled manual paths in §2).

### 1.2 Per-user automation state (freshness / queue)

```sql
select user_id, status, signal_version, input_watermark,
       last_success_at, last_failed_at, failure_code, failure_message,
       consecutive_failure_count, updated_at
  from layer1_user_recompute_state
 where user_id = $USER_ID::uuid;
```

- **`status`:** `never_computed`, `queued`, `running`, `fresh`, **`stale`**, **`failed`**, **`failed_exhausted`** (failure budget exhausted — see VS-56 / VS-84).
- **`signal_version`:** Must match the deploy’s active composite **`LAYER1_ACTIVE_SIGNAL_VERSION`** (`packages/domain/src/evidence/layer1ActiveSignalVersion.ts`) after a successful run. A **mismatch** means persisted state is **stale relative to current code contracts** until a successful recompute updates it.
- **`input_watermark`:** Input frontier last observed after successful materialization; reconciliation compares this to the live watermark from listens / imports (see VS-92). **Do not treat “fresh” as “has evidence for every artist”** — caps and insufficiency paths are normal.

### 1.3 Job / run provenance

```sql
select id, started_at, completed_at, status, trigger_kind, error_code, left(error_detail, 200) as error_detail_prefix, context_json
  from layer1_signal_runs
 where context_json::text like '%' || $USER_ID || '%'
    or id in (
         select distinct layer1_signal_run_id
           from layer1_evidence_objects
          where user_id = $USER_ID::uuid
            and layer1_signal_run_id is not null
       )
 order by started_at desc
 limit 20;
```

`trigger_kind` / `context_json.enqueue_reason` align with the closed vocabulary (`import_completed`, `listen_ingested`, `advanced_upgrade`, `nightly_reconciliation`, `admin_manual`, `internal_backfill`, … — `packages/queue/src/job-contracts.ts`). **`failed`** runs carry `error_code` / `error_detail`; worker uses **`UnrecoverableError`** so failed runs are visible, not silently retried into success.

### 1.4 Evidence rows (did work land?)

```sql
select signal_kind, signal_instance_id, created_at, layer1_signal_run_id
  from layer1_evidence_objects
 where user_id = $USER_ID::uuid
 order by created_at desc
 limit 50;
```

### 1.5 Queue backlog (optional)

From repo root:

```bash
npm run inspect:bullmq-queues
```

Use this when jobs are not draining — **Redis counts** are authoritative for backlog; correlate with worker logs (`vs-worker:layer1_recompute`, `vs-db:artistUserRelationshipLayer1`).

---

## 2. Manually recompute for a user

Use **only** when automatic triggers are insufficient (incident, misconfiguration recovery, deliberate backfill).

| Path | When to use |
| --- | --- |
| **`POST /api/admin/users/:userId/layer1-recompute`** | Staff session; target must be **Advanced**. Core targets get **403** `layer1_admin_recompute_requires_advanced_plan`. Audited as `admin_manual`. |
| **`npm run enqueue:layer1-recompute -- --users <uuid>[,uuid…]`** | **Non-production** deploy tier only (`deployEnv !== "production"`). Uses entitlement override for debug/backfill; reason `admin_manual`. Up to **200** UUIDs per job. |

After enqueue, confirm a new `layer1_signal_runs` row and that `layer1_user_recompute_state` moves through `queued` / `running` toward `fresh` or a visible failure.

**Cursor batch backfill** (`--cursor-batch`) is internal paging with `internal_backfill` — not per-user entitled at enqueue time; use only under operational guardrails (see [one-pager](../layer1-developer-one-pager.md)).

---

## 3. Stale, missing, or failed states (what to look for)

| Signal | Meaning |
| --- | --- |
| `status in ('stale','failed','failed_exhausted','never_computed')` | User-level state is **not** “successfully current”; pair with `failure_code` / `failure_message` and latest `layer1_signal_runs`. |
| `signal_version` ≠ deploy’s `LAYER1_ACTIVE_SIGNAL_VERSION` | Contract drift — nightly reconciliation can enqueue, or manual recompute after you confirm worker health. |
| `layer1_signal_runs.status = 'failed'` | Job-level failure with persisted `error_code`; check worker logs for the same correlation window. |
| Advanced user, empty or old `layer1_evidence_objects` | May be **insufficient listens**, import not completed, **worker down**, or **queue skipped** — triangulate with `layer1_user_recompute_state` and import job rows — not guesswork. |
| Core `product_plan` | **Expected:** no product Layer 1; not a worker defect. |

Treat **HTTP 200** on product APIs as **non-proof** of fresh Layer 1 — read persisted state and runs.

---

## 4. After Core → Advanced upgrade

1. **Entitlement:** Once `product_plan` is **Advanced**, product code enqueues Layer 1 with reason **`advanced_upgrade`** (see `packages/db/src/adminUserProductPlanLayer1Enqueue.ts` / admin product-plan flow in VS-92).
2. **Expectation:** Backfill runs on the **worker**; users may see evidence populate after jobs complete — not synchronously in the admin mutation response.
3. **Reconciliation:** The nightly sweep still selects Advanced users who are missing, stale, failed (past cooldown), or behind signal version / input watermark — so delayed or missed single-shot enqueues can be **caught up** if the worker tick is healthy.
4. **If nothing moves:** Check § Preconditions, `layer1_signal_runs`, and BullMQ `analytics` depth — same as any other user.

---

## 5. Escalation pointers

- **Caps / skipped artists:** [VS-56](../performance/vs-56-layer1-performance-and-failure-modes.md) (`window_plays_exceed_processing_cap`, artist limits).
- **All enqueue entry points:** [VS-72](../implementation-notes/VS-72-task-1-1-layer1-recompute-entry-points.md).
