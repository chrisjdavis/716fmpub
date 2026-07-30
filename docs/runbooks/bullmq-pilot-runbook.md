# BullMQ operational runbook (pilot)

This runbook is for operators running the 716FM pilot stack where **Redis + BullMQ hold queue state** and the **standalone worker** (`apps/worker`) is the **intended** consumer of canonical VS queues in the **default pilot layout** (one worker process). Deliberately running **multiple** worker replicas against the same `REDIS_URL` adds consumers per §4.2—do not do that by accident. Treat mismatches between Postgres pipeline rows and Redis as **visible incidents**: use the inspection scripts and logs rather than inferring health from the UI alone.

## Canonical queues

| Queue name (`VS_QUEUE_NAMES`) | Purpose (short) | Operator notes |
|-------------------------------|-----------------|---------------|
| `vs-smoke-test` | Wiring checks | Safe to drain in dev; not production traffic |
| `imports` | Last.fm row ingestion on `imports` | User- and API-driven jobs on this queue; `system_sync` incremental pulls use `incremental_sync` / tick paths (see README) |
| `exports` | ZIP export generation | Job id aligns with export row UUID where documented |
| `analytics` | Windowed recompute (stub) | Invalid payloads fail with `UnrecoverableError` until implemented |
| `sync` | Listen catch-up scheduling | Fails with structured reason when DB declines enqueue |
| `incremental_sync` | Bounded `system_sync` pulls | Separate from `imports` |

Ad-hoc queue names are unsupported; producers and workers must share `@vs/queue` constants.

---

## 1. Startup (pilot)

### 1.1 Preconditions

1. **PostgreSQL** reachable; migrations applied (`npm run db:migrate` from repo root when schema changes).
2. **Redis** reachable at `REDIS_URL` (same value for Next.js, worker, and any queue scripts).
3. **Root `.env`** present with at least `DATABASE_URL` and `REDIS_URL` (see `.env.example`). Invalid env fails fast at `loadServerEnv()` — there are no silent fallbacks.
4. Optional: `LASTFM_API_KEY` for real imports; without it, import jobs fail with a persisted message the dashboard can show.

### 1.2 Boot order (recommended)

1. Start **infrastructure** (e.g. `docker compose up -d postgres redis` or your managed equivalents).
2. Start the **Next.js web server** (`npm run dev` or production `next start` for your deployment). The server validates env and exercises the BullMQ producer stack once at boot (`ensureBullMqProducerStackReady()` in `apps/web` instrumentation — see README).
3. Start **one worker process per pilot environment** (default) that registers all canonical workers: `npm run dev:worker` (watch) or `npm run start:worker` (production-style). Additional replicas are an explicit capacity decision; see §4.2. On boot the worker:
   - Verifies Redis (`verifyRedisConnectivity`).
   - Registers one BullMQ `Worker` per canonical queue with concurrency from env (see §4).
   - Logs `worker_bullmq_concurrency_config` with the full `queueName(concurrency=N)` summary.
   - Runs the import tick loop only when Postgres is reachable; if DB is down, ticks log **degraded** and skip pipeline work until DB returns.

### 1.3 First green checks

```bash
npm run inspect:bullmq-queues
```

Expect JSON lines prefixed for log routing; exit non-zero if Redis is down or queue reads fail (use `--allow-partial` only when you intentionally accept partial snapshots). Optional smoke:

```bash
npm run enqueue:smoke-test
```

Worker logs should show the smoke job completing on `vs-smoke-test`.

---

## 2. Shutdown (pilot)

### 2.1 Worker

- Send **SIGINT** or **SIGTERM once** (e.g. Ctrl+C in dev). The worker sets a shutdown flag, **stops the DB tick interval**, awaits **`bullmq.closeAll()`** (drains/closes all `Worker` instances), then closes the Postgres pool.
- Avoid **SIGKILL** except in emergencies: in-flight jobs may stall in Redis until BullMQ stall recovery rules apply, and Postgres `running` rows may appear stale until the next recovery tick (see §3).

### 2.2 Web / Redis

- Stop the web process with the same signals your platform uses for graceful Node shutdown.
- **Do not** flush Redis in pilot unless you understand you are deleting **all** queue metadata and delayed jobs for that namespace.

---

## 3. Debug and recovery

### 3.1 Queue depth and samples (Redis source of truth)

```bash
npm run inspect:bullmq-queues
```

- **Counts** in the snapshot are authoritative for backlog buckets; **job rows are capped samples** per bucket. If `listTruncated` is true, raise `VS_QUEUE_INSPECT_JOB_SAMPLE_LIMIT` (0–500) or use Redis-native tooling for a full dump.
- **Waiting vs paused:** the inspector resolves `getJobState` so paused work is not mislabeled as ordinary waiting backlog.

Default exit: **non-zero** if any single-queue read fails. Pass `--allow-partial` for exit 0 when at least one queue succeeded.

### 3.2 Pipeline stalls (Postgres source of truth)

Long-running import/export rows use `updated_at` as liveness. A row in `running` with no progress bump for **600 seconds** (default `DEFAULT_STALE_RUNNING_PIPELINE_SECONDS`) is treated as stalled.

**Read-only detection:**

```bash
npm run inspect:stalled-db-jobs
```

Optional: `VS_STALLED_JOB_PROBE_SECONDS` (1–86400) overrides the cutoff for this script only.

**Automatic recovery:** the worker tick runs `requeueStaleRunningImportJobs` and export stale recovery (`runExportStaleRecoveryTick`) so rows return to `queued` and work is republished where contracts allow.

### 3.3 Operator recovery checklist (condensed)

1. Confirm **worker is running**, Postgres and Redis healthy.
2. Run `npm run inspect:stalled-db-jobs`. Non-empty output means rows matched the window **at probe time**; wait for the next successful tick or restart the worker after fixing infra.
3. **Exports:** if a row is `queued` but stderr shows **re-enqueue failure**, Redis may still hold a zombie BullMQ job whose `jobId` equals the export UUID. Inspect `exports` via `inspect:bullmq-queues` or Redis CLI, remove or fail the stuck job, then wait for the tick or restart the worker.
4. **Imports:** if rows stay `queued` without a Redis job after a failed republish, restore Redis connectivity and keep the worker up; avoid manual enqueue unless you follow internal job contracts.

Retries are designed to be **dedupe-safe** (stale import recovery resets checkpoints; stale export recovery clears partial ZIP progress).

### 3.4 Structured logs

Search worker output for:

- `worker_bullmq_concurrency_config` — confirms effective per-queue concurrency at boot.
- `job_started` / `job_completed` / `job_failed` — includes safe identity fields from job payloads when present.
- `worker_bullmq_runtime_error` — Redis connection or worker runtime faults.

### 3.5 When not to guess

- **Do not** invent ETAs or “healthy” summaries from partial samples; use counts + `inspect:stalled-db-jobs` + dashboard DB-backed fields.
- **Invalid payloads** and **declined sync** paths fail jobs with **`UnrecoverableError`** and explicit messages — treat as contract violations or business rules, not flaky retries.

---

## 4. Concurrency guidelines (pilot)

### 4.1 Per-queue settings (worker only)

Concurrency is configured via **environment variables** (integers **1–64**), validated in `@vs/env`:

| Variable | Default |
|----------|---------|
| `BULLMQ_WORKER_CONCURRENCY_SMOKE_TEST` | 1 |
| `BULLMQ_WORKER_CONCURRENCY_IMPORTS` | 2 |
| `BULLMQ_WORKER_CONCURRENCY_EXPORTS` | 1 |
| `BULLMQ_WORKER_CONCURRENCY_ANALYTICS` | 1 |
| `BULLMQ_WORKER_CONCURRENCY_SYNC` | 2 |
| `BULLMQ_WORKER_CONCURRENCY_INCREMENTAL_SYNC` | 2 |

After changing any of these, **restart the worker** so `registerBullMqWorkers` rebuilds `Worker` instances.

### 4.2 Process-level rules

- **One worker binary per pilot environment** registers **six** workers (one per queue). That is the supported layout in this repo today.
- **Horizontal scale:** running **multiple** worker processes against the **same** `REDIS_URL` and queue names **adds** consumers: effective throughput is roughly the sum of per-process concurrencies per queue. Only scale out after checking **Postgres connection limits**, **Last.fm rate limits**, **Redis command volume**, and **export disk / CPU** — otherwise you amplify contention and stall recovery noise without a capacity plan.
- **Imports** share Last.fm pacing (`IMPORT_LASTFM_PAGE_MIN_INTERVAL_MS`, `IMPORT_LASTFM_PAGE_BURST`); raising `BULLMQ_WORKER_CONCURRENCY_IMPORTS` without raising API capacity can increase 429s and transient failures — monitor `job_failed` and dashboard `error_message` fields.

### 4.3 Pilot recommendation

Keep defaults until metrics show headroom. Raise a single queue’s concurrency in response to measured backlog and stable p95 job duration, not UI lag alone.

---

## 5. Quick reference (commands)

| Goal | Command |
|------|---------|
| Dev worker | `npm run dev:worker` |
| Prod-style worker | `npm run start:worker` |
| Queue snapshot | `npm run inspect:bullmq-queues` |
| Stalled DB pipelines | `npm run inspect:stalled-db-jobs` |
| Smoke enqueue | `npm run enqueue:smoke-test` |

All commands assume **repository root** and `dotenv-cli` loading `.env` as wired in root `package.json`.

---

## 6. Related documentation

- `README.md` — environment contracts, inspector semantics, stalled-job deep dive, local and private e2e flows.
