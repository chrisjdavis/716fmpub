/**
 * Import job persistence helpers.
 *
 * Lifecycle invariants are enforced in SQL (`WHERE stage = …` on updates). The
 * `@vs/domain` transition helpers mirror those paths for orchestration code;
 * keep them aligned when stages or allowed paths change (including
 * `running -> queued` for stale worker recovery via `requeueStaleRunningImportJobs`).
 * `listStaleRunningImportJobs` mirrors the same staleness predicate read-only for operators.
 */
import type { ImportPipelineStage } from "@vs/domain";
import { parseImportPipelineStage } from "@vs/domain";
import type { Pool, PoolClient, QueryResultRow } from "pg";

/**
 * Deterministic "newest first" ordering for a user's import jobs.
 * Shared by import job queries and HTTP list routes so `latest` cannot diverge on `created_at` ties.
 */
export const IMPORT_JOBS_USER_SCOPED_NEWEST_FIRST_ORDER_BY =
  "created_at desc, id desc" as const;

const IMPORT_JOB_ROW_SELECT = `id, user_id, label, lastfm_username, source, stage, error_message, items_total, items_processed, checkpoint_pages_completed, checkpoint_oldest_uts, created_at, updated_at`;

/** `RETURNING` list for `claimNextQueuedImportJob` (alias `ij`); must stay aligned with `IMPORT_JOB_ROW_SELECT`. */
const IMPORT_JOB_CLAIM_RETURNING = `ij.id, ij.user_id, ij.label, ij.lastfm_username, ij.source, ij.stage, ij.error_message, ij.items_total, ij.items_processed, ij.checkpoint_pages_completed, ij.checkpoint_oldest_uts, ij.created_at, ij.updated_at`;

export type ImportJobSource = "user" | "system_sync";

function parseImportJobSource(raw: unknown): ImportJobSource {
  if (raw === "system_sync") {
    return "system_sync";
  }
  return "user";
}

export type ImportJobRecord = {
  id: string;
  user_id: string;
  label: string;
  /** Last.fm account name to fetch for this job (explicit contract; not inferred from label). */
  lastfm_username: string;
  /** User-initiated imports vs worker background incremental sync. */
  source: ImportJobSource;
  stage: ImportPipelineStage;
  error_message: string | null;
  items_total: number | null;
  items_processed: number;
  /**
   * Count of Last.fm pages whose rows were fully persisted in this job.
   * Used with `checkpoint_oldest_uts` for restart/resume boundaries.
   */
  checkpoint_pages_completed: number;
  /**
   * Oldest listen `uts` on the last fully persisted page (Last.fm ordering is newest-first).
   * Passed as `to` for the next provider request after a transient failure rebuilds the iterator.
   */
  checkpoint_oldest_uts: bigint | null;
  created_at: string;
  updated_at: string;
};

/**
 * Anything that can run parameterized SQL for import job rows.
 * Uses `Pick` so tests can supply a minimal `{ query }` mock.
 */
export type ImportJobDbExecutor =
  | Pick<Pool, "query">
  | Pick<PoolClient, "query">;

function mapRow(row: QueryResultRow): ImportJobRecord {
  const rawStage = String(row["stage"]);
  const stage = parseImportPipelineStage(rawStage);
  if (stage === null) {
    throw new Error(
      `import_jobs row has invalid stage "${rawStage}" (id=${String(row["id"])})`,
    );
  }
  const rawCp = row["checkpoint_pages_completed"];
  const rawOldest = row["checkpoint_oldest_uts"];
  return {
    id: String(row["id"]),
    user_id: String(row["user_id"]),
    label: String(row["label"]),
    lastfm_username: String(row["lastfm_username"]),
    source: parseImportJobSource(row["source"]),
    stage,
    error_message:
      row["error_message"] === null || row["error_message"] === undefined
        ? null
        : String(row["error_message"]),
    items_total:
      row["items_total"] === null || row["items_total"] === undefined
        ? null
        : Number(row["items_total"]),
    items_processed: Number(row["items_processed"]),
    checkpoint_pages_completed:
      rawCp === null || rawCp === undefined ? 0 : Number(rawCp),
    checkpoint_oldest_uts:
      rawOldest === null || rawOldest === undefined
        ? null
        : BigInt(String(rawOldest)),
    created_at: String(row["created_at"]),
    updated_at: String(row["updated_at"]),
  };
}

export async function createImportJob(
  db: ImportJobDbExecutor,
  input: {
    userId: string;
    label: string;
    lastfmUsername: string;
    source?: ImportJobSource;
  },
): Promise<{ id: string }> {
  const source: ImportJobSource = input.source ?? "user";
  const { rows } = await db.query<{ id: string }>(
    `insert into import_jobs (user_id, label, lastfm_username, stage, source)
     values ($1::uuid, $2, $3, 'queued', $4::text)
     returning id`,
    [input.userId, input.label, input.lastfmUsername, source],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("createImportJob: insert returned no row");
  }
  return { id: row.id };
}

/**
 * Atomically claims the oldest queued **`system_sync`** import job for this process using
 * `FOR UPDATE SKIP LOCKED` so concurrent workers do not claim the same row.
 * User-sourced (`source = 'user'`) jobs are scheduled only via BullMQ `imports`
 * producers after insert (including stale re-queue re-enqueue from the worker tick).
 * Runs a dedicated transaction on `client` (begin/commit/rollback).
 *
 * The caller **must** use a dedicated `PoolClient` that is not already inside
 * an application transaction; otherwise nested BEGIN behavior is undefined.
 */
export async function claimNextQueuedImportJob(
  client: PoolClient,
): Promise<ImportJobRecord | null> {
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `with picked as (
         select id
         from import_jobs
         where stage = 'queued'
           and source = 'system_sync'
         order by created_at asc, id asc
         limit 1
         for update skip locked
       )
       update import_jobs ij
       set stage = 'running', updated_at = now()
       from picked p
       where ij.id = p.id
       returning ${IMPORT_JOB_CLAIM_RETURNING}`,
    );
    await client.query("commit");
    const row = rows[0];
    return row ? mapRow(row) : null;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  }
}

/** Acquires a connection, claims one job, releases — avoids nested-transaction misuse. */
export async function claimNextQueuedImportJobWithPool(
  pool: Pool,
): Promise<ImportJobRecord | null> {
  const client = await pool.connect();
  try {
    return await claimNextQueuedImportJob(client);
  } finally {
    client.release();
  }
}

/**
 * Oldest `queued` background sync rows for idempotent BullMQ publish (`jobId` = import id).
 * Does not claim rows — the incremental worker transitions via `markImportJobRunning`.
 */
export async function listQueuedSystemSyncImportJobsForEnqueue(
  db: ImportJobDbExecutor,
  input: { limit: number },
): Promise<ReadonlyArray<{ id: string; userId: string }>> {
  const cap = Math.min(Math.max(1, Math.floor(input.limit)), 50);
  const { rows } = await db.query<{ id: string; user_id: string }>(
    `select id, user_id
     from import_jobs
     where stage = 'queued'
       and source = 'system_sync'
     order by created_at asc, id asc
     limit $1::int`,
    [cap],
  );
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
  }));
}

export type RequeuedStaleImportJob = {
  id: string;
  userId: string;
  source: ImportJobSource;
};

/**
 * Read-only snapshot of `import_jobs` rows that match the same staleness rule as
 * `requeueStaleRunningImportJobs` (no mutation). Used for operator probes and dashboards.
 */
export type StaleRunningImportJobSnapshot = {
  id: string;
  userId: string;
  source: ImportJobSource;
  updatedAt: string;
  itemsProcessed: number;
};

export async function listStaleRunningImportJobs(
  db: ImportJobDbExecutor,
  input: { staleAfterSeconds: number },
): Promise<StaleRunningImportJobSnapshot[]> {
  const { rows } = await db.query<{
    id: string;
    user_id: string;
    source: unknown;
    updated_at: string;
    items_processed: number | string;
  }>(
    `select id, user_id, source, updated_at, items_processed
     from import_jobs
     where stage = 'running'
       and updated_at < now() - ($1::bigint * interval '1 second')
     order by updated_at asc, id asc`,
    [input.staleAfterSeconds],
  );
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    source: parseImportJobSource(r.source),
    updatedAt: String(r.updated_at),
    itemsProcessed: Number(r.items_processed),
  }));
}

/**
 * Re-queues `running` jobs whose `updated_at` is older than the cutoff (worker likely crashed).
 * Progress and checkpoint columns are reset so the next run starts from the newest page again;
 * `raw_scrobbles` inserts remain idempotent on `(user_id, source_event_hash)`.
 * `error_message` records a deterministic stale notice and preserves a truncated prior message when present.
 *
 * Returns each re-queued row so callers can re-publish BullMQ work for `source = 'user'` jobs
 * (the import tick no longer claims user-sourced queued rows).
 */
export async function requeueStaleRunningImportJobs(
  db: ImportJobDbExecutor,
  input: { staleAfterSeconds: number },
): Promise<RequeuedStaleImportJob[]> {
  const { rows } = await db.query<{
    id: string;
    user_id: string;
    source: unknown;
  }>(
    `update import_jobs
     set
       stage = 'queued',
       items_processed = 0,
       items_total = null,
       checkpoint_pages_completed = 0,
       checkpoint_oldest_uts = null,
       error_message = left(
         'Stale running import re-queued: no progress update within '
           || cast($1::bigint as text)
           || ' seconds; counters reset for dedupe-safe replay.'
           || case
                when coalesce(nullif(trim(error_message), ''), '') <> '' then
                  E'\n\nPrevious error_message (truncated):\n'
                  || left(error_message, 3500)
                else ''
              end,
         7900
       ),
       updated_at = now()
     where stage = 'running'
       and updated_at < now() - ($1::bigint * interval '1 second')
     returning id, user_id, source`,
    [input.staleAfterSeconds],
  );
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    source: parseImportJobSource(r.source),
  }));
}

export async function getImportJobByIdForUser(
  db: ImportJobDbExecutor,
  input: Readonly<{ jobId: string; userId: string; source?: ImportJobSource }>,
): Promise<ImportJobRecord | null> {
  const { rows } =
    input.source === undefined
      ? await db.query(
          `select ${IMPORT_JOB_ROW_SELECT}
     from import_jobs
     where id = $1::uuid
       and user_id = $2::uuid
     limit 1`,
          [input.jobId, input.userId],
        )
      : await db.query(
          `select ${IMPORT_JOB_ROW_SELECT}
     from import_jobs
     where id = $1::uuid
       and user_id = $2::uuid
       and source = $3::text
     limit 1`,
          [input.jobId, input.userId, input.source],
        );
  const row = rows[0];
  return row ? mapRow(row as QueryResultRow) : null;
}

export async function markImportJobRunning(
  db: ImportJobDbExecutor,
  input: { jobId: string; userId: string },
): Promise<ImportJobRecord | null> {
  const { rows } = await db.query(
    `update import_jobs
     set stage = 'running', updated_at = now()
     where id = $1::uuid
       and user_id = $2::uuid
       and stage = 'queued'
     returning ${IMPORT_JOB_ROW_SELECT}`,
    [input.jobId, input.userId],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/**
 * After an unexpected BullMQ processor throw, moves `running -> queued` so the next
 * queue attempt can `markImportJobRunning` again. **Preserves checkpoints** and
 * progress counters (unlike `requeueStaleRunningImportJobs`, which resets for stale
 * detection). Replay remains idempotent on raw inserts.
 */
export async function requeueRunningImportJobForBullMqRetry(
  db: ImportJobDbExecutor,
  input: { jobId: string; userId: string },
): Promise<ImportJobRecord | null> {
  const { rows } = await db.query(
    `update import_jobs
     set stage = 'queued', updated_at = now()
     where id = $1::uuid
       and user_id = $2::uuid
       and stage = 'running'
     returning ${IMPORT_JOB_ROW_SELECT}`,
    [input.jobId, input.userId],
  );
  const row = rows[0];
  return row ? mapRow(row as QueryResultRow) : null;
}

export async function markImportJobCompleted(
  db: ImportJobDbExecutor,
  input: { jobId: string; userId: string; warningMessage?: string | null },
): Promise<ImportJobRecord | null> {
  const { rows } = await db.query(
    `update import_jobs
     set stage = 'completed',
        error_message = $3,
        updated_at = now()
     where id = $1::uuid
       and user_id = $2::uuid
       and stage = 'running'
     returning ${IMPORT_JOB_ROW_SELECT}`,
    [input.jobId, input.userId, input.warningMessage ?? null],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function markImportJobFailed(
  db: ImportJobDbExecutor,
  input: { jobId: string; userId: string; errorMessage: string },
): Promise<ImportJobRecord | null> {
  const { rows } = await db.query(
    `update import_jobs
     set stage = 'failed',
        error_message = $3,
        updated_at = now()
     where id = $1::uuid
       and user_id = $2::uuid
       and stage in ('queued', 'running')
     returning ${IMPORT_JOB_ROW_SELECT}`,
    [input.jobId, input.userId, input.errorMessage],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/**
 * Same as `markImportJobFailed` but only matches `running`, for rare handoffs
 * where the broader transition already returned null.
 */
export async function markImportJobFailedWhenRunning(
  db: ImportJobDbExecutor,
  input: { jobId: string; userId: string; errorMessage: string },
): Promise<ImportJobRecord | null> {
  const { rows } = await db.query(
    `update import_jobs
     set stage = 'failed',
        error_message = $3,
        updated_at = now()
     where id = $1::uuid
       and user_id = $2::uuid
       and stage = 'running'
     returning ${IMPORT_JOB_ROW_SELECT}`,
    [input.jobId, input.userId, input.errorMessage],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/**
 * Updates progress for a running job. Counters are monotonic for `items_processed`.
 * When `items_total` is already set, `items_processed` is clamped to that total.
 */
export async function updateImportJobProgress(
  db: ImportJobDbExecutor,
  input: {
    jobId: string;
    userId: string;
    itemsProcessed: number;
    itemsTotal?: number | null;
    /** When set, replaces `checkpoint_pages_completed` for this row. */
    checkpointPagesCompleted?: number | null;
    /** When set (including explicit `null`), replaces `checkpoint_oldest_uts`. Omit to leave unchanged. */
    checkpointOldestUts?: bigint | null;
  },
): Promise<ImportJobRecord | null> {
  const hasCheckpointPages = input.checkpointPagesCompleted !== undefined;
  const hasCheckpointUts = input.checkpointOldestUts !== undefined;
  const { rows } = await db.query(
    `update import_jobs
     set
       items_total = coalesce($3::integer, items_total),
       items_processed = case
         when items_total is not null then least(
           items_total,
           greatest(items_processed, $4::integer)
         )
         else greatest(items_processed, $4::integer)
       end,
       checkpoint_pages_completed = case
         when $5::boolean then $6::integer
         else checkpoint_pages_completed
       end,
       checkpoint_oldest_uts = case
         when $7::boolean then $8::bigint
         else checkpoint_oldest_uts
       end,
       updated_at = now()
     where id = $1::uuid
       and user_id = $2::uuid
       and stage = 'running'
     returning ${IMPORT_JOB_ROW_SELECT}`,
    [
      input.jobId,
      input.userId,
      input.itemsTotal ?? null,
      input.itemsProcessed,
      hasCheckpointPages,
      hasCheckpointPages ? input.checkpointPagesCompleted : null,
      hasCheckpointUts,
      hasCheckpointUts
        ? input.checkpointOldestUts === null
          ? null
          : String(input.checkpointOldestUts)
        : null,
    ],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function getLatestImportJobForUser(
  db: ImportJobDbExecutor,
  userId: string,
): Promise<ImportJobRecord | null> {
  const { rows } = await db.query(
    `select ${IMPORT_JOB_ROW_SELECT}
     from import_jobs
     where user_id = $1::uuid
     order by ${IMPORT_JOBS_USER_SCOPED_NEWEST_FIRST_ORDER_BY}
     limit 1`,
    [userId],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/**
 * Newest **user-visible** import job (excludes worker `system_sync` rows) for dashboard/API.
 */
export async function getLatestDashboardImportJobForUser(
  db: ImportJobDbExecutor,
  userId: string,
): Promise<ImportJobRecord | null> {
  const { rows } = await db.query(
    `select ${IMPORT_JOB_ROW_SELECT}
     from import_jobs
     where user_id = $1::uuid
       and source = 'user'
     order by ${IMPORT_JOBS_USER_SCOPED_NEWEST_FIRST_ORDER_BY}
     limit 1`,
    [userId],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

const IMPORT_JOBS_LIST_MAX = 100 as const;

/**
 * Newest-first import jobs for the user (manual + background), capped for UI lists.
 * Use `offset` for paging (0-based).
 */
export async function listImportJobsForUser(
  db: ImportJobDbExecutor,
  input: { userId: string; limit?: number; offset?: number },
): Promise<ImportJobRecord[]> {
  const rawLimit = input.limit ?? 50;
  const limit = Math.min(
    IMPORT_JOBS_LIST_MAX,
    Math.max(1, Math.floor(rawLimit)),
  );
  const rawOffset = input.offset ?? 0;
  const offset = Math.max(0, Math.floor(rawOffset));
  const { rows } = await db.query(
    `select ${IMPORT_JOB_ROW_SELECT}
     from import_jobs
     where user_id = $1::uuid
     order by ${IMPORT_JOBS_USER_SCOPED_NEWEST_FIRST_ORDER_BY}
     limit $2::int
     offset $3::int`,
    [input.userId, limit, offset],
  );
  return rows.map((r) => mapRow(r as QueryResultRow));
}

/**
 * Newest-first page of import jobs plus total row count for the user, in one round trip when the
 * page returns rows. When `LIMIT`/`OFFSET` yields zero rows (empty table or offset past the end),
 * falls back to {@link countImportJobsForUser} so `totalCount` is still defined.
 */
export async function listImportJobsForUserWithTotalCount(
  db: ImportJobDbExecutor,
  input: { userId: string; limit?: number; offset?: number },
): Promise<{ records: ImportJobRecord[]; totalCount: number }> {
  const rawLimit = input.limit ?? 50;
  const limit = Math.min(
    IMPORT_JOBS_LIST_MAX,
    Math.max(1, Math.floor(rawLimit)),
  );
  const rawOffset = input.offset ?? 0;
  const offset = Math.max(0, Math.floor(rawOffset));
  const { rows } = await db.query(
    `with agg as (
       select count(*)::int as total_count
       from import_jobs
       where user_id = $1::uuid
     )
     select ${IMPORT_JOB_ROW_SELECT}, agg.total_count as vs_total_count
     from import_jobs
     cross join agg
     where import_jobs.user_id = $1::uuid
     order by ${IMPORT_JOBS_USER_SCOPED_NEWEST_FIRST_ORDER_BY}
     limit $2::int
     offset $3::int`,
    [input.userId, limit, offset],
  );
  if (rows.length === 0) {
    const totalCount = await countImportJobsForUser(db, input.userId);
    return { records: [], totalCount };
  }
  const rawTc = rows[0]?.["vs_total_count"];
  const n = typeof rawTc === "number" ? rawTc : Number(rawTc);
  const totalCount = Number.isFinite(n) ? n : 0;
  return {
    records: rows.map((r) => mapRow(r as QueryResultRow)),
    totalCount,
  };
}

/** Total import job rows for the user (manual + background), for paging. */
export async function countImportJobsForUser(
  db: ImportJobDbExecutor,
  userId: string,
): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as c
     from import_jobs
     where user_id = $1::uuid`,
    [userId],
  );
  const raw = rows[0]?.["c"];
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Rows still eligible for worker pickup (`queued` or `running`), any source.
 * Matches listen-sync eligibility so a user never holds two concurrent pipelines.
 */
export async function countActiveImportJobsForUser(
  db: ImportJobDbExecutor,
  userId: string,
): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as c
     from import_jobs
     where user_id = $1::uuid
       and stage in ('queued', 'running')`,
    [userId],
  );
  const raw = rows[0]?.["c"];
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Runs `fn` inside a single read/write transaction (default PostgreSQL isolation). */
export async function withImportJobTransaction<T>(
  client: PoolClient,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
}
