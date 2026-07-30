import type { Pool } from "pg";

export type ListenExportFormat = "json" | "csv";

export type ExportJobStage = "queued" | "running" | "completed" | "failed" | "expired";

export type ExportJobDbExecutor = Pick<Pool, "query">;

export type ListenExportArtifactAccess = "none" | "available" | "expired";

export type ExportJobRecord = Readonly<{
  id: string;
  userId: string;
  format: ListenExportFormat;
  stage: ExportJobStage;
  artifactRelativePath: string | null;
  artifactExpiresAt: string | null;
  /**
   * Opaque per-artifact secret required on `GET .../download?token=...`.
   * Null while not completed; cleared when the row is expired and the path is detached.
   */
  artifactDeliveryToken: string | null;
  errorMessage: string | null;
  bullmqJobId: string | null;
  /** Rows written so far for listen exports (`stage = running` updates during ZIP build). */
  itemsProcessed: number;
  /**
   * Final listen count when `stage = completed` (equals `items_processed` at completion).
   * Null while queued/running or when unknown — clients must not infer a denominator.
   */
  itemsTotal: number | null;
  createdAt: string;
  updatedAt: string;
}>;

export const LISTEN_EXPORT_EXPIRED_ERROR_MESSAGE =
  "Export expired. Generate a new export from the dashboard." as const;

/**
 * Whether a completed listen-export ZIP may be streamed to the owner.
 * Uses explicit `artifact_expires_at` from the database (no client-side guessing).
 */
export function computeListenExportArtifactAccess(
  row: ExportJobRecord,
  nowMs: number = Date.now(),
): ListenExportArtifactAccess {
  if (row.stage === "expired") {
    return "expired";
  }
  if (row.stage !== "completed") {
    return "none";
  }
  const rel = row.artifactRelativePath;
  const exp = row.artifactExpiresAt;
  const tok = row.artifactDeliveryToken;
  if (!rel || !exp) {
    return "none";
  }
  if (!tok || tok.trim().length < 32) {
    return "none";
  }
  const expMs = Date.parse(exp);
  if (!Number.isFinite(expMs)) {
    return "none";
  }
  if (expMs <= nowMs) {
    return "expired";
  }
  return "available";
}

function mapRow(row: {
  id: string;
  user_id: string;
  format: string;
  stage: string;
  artifact_relative_path: string | null;
  artifact_expires_at: string | null;
  artifact_delivery_token?: string | null;
  error_message: string | null;
  bullmq_job_id: string | null;
  items_processed: number | string;
  items_total: number | string | null;
  created_at: string;
  updated_at: string;
}): ExportJobRecord {
  const processed =
    typeof row.items_processed === "number" ? row.items_processed : Number(row.items_processed);
  const rawTotal = row.items_total;
  const total =
    rawTotal === null || rawTotal === undefined
      ? null
      : typeof rawTotal === "number"
        ? rawTotal
        : Number(rawTotal);
  return {
    id: row.id,
    userId: row.user_id,
    format: row.format as ListenExportFormat,
    stage: row.stage as ExportJobStage,
    artifactRelativePath: row.artifact_relative_path,
    artifactExpiresAt: row.artifact_expires_at,
    artifactDeliveryToken:
      row.artifact_delivery_token === undefined || row.artifact_delivery_token === null
        ? null
        : String(row.artifact_delivery_token),
    errorMessage: row.error_message,
    bullmqJobId: row.bullmq_job_id,
    itemsProcessed: Number.isFinite(processed) ? processed : 0,
    itemsTotal: total !== null && Number.isFinite(total) ? total : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Rows still eligible for worker pickup (`queued` or `running`). At most one per user
 * is enforced by `export_jobs_user_one_active_stage_uidx` (see migrations).
 */
/**
 * Read-only: `export_jobs` in `running` with no `updated_at` heartbeat within the cutoff
 * (same predicate the worker uses before `requeueStaleRunningExportJobs`).
 */
export type StaleRunningExportJobSnapshot = Readonly<{
  id: string;
  userId: string;
  format: ListenExportFormat;
  updatedAt: string;
  itemsProcessed: number;
  bullmqJobId: string | null;
}>;

export async function listStaleRunningExportJobs(
  db: ExportJobDbExecutor,
  input: Readonly<{ staleAfterSeconds: number }>,
): Promise<StaleRunningExportJobSnapshot[]> {
  const { rows } = await db.query<{
    id: string;
    user_id: string;
    format: string;
    updated_at: string;
    items_processed: number | string;
    bullmq_job_id: string | null;
  }>(
    `select id, user_id, format, updated_at, items_processed, bullmq_job_id
     from export_jobs
     where stage = 'running'
       and updated_at < now() - ($1::bigint * interval '1 second')
     order by updated_at asc, id asc`,
    [input.staleAfterSeconds],
  );
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    format: r.format as ListenExportFormat,
    updatedAt: String(r.updated_at),
    itemsProcessed:
      typeof r.items_processed === "number"
        ? r.items_processed
        : Number(r.items_processed),
    bullmqJobId:
      r.bullmq_job_id === null || r.bullmq_job_id === undefined
        ? null
        : String(r.bullmq_job_id),
  }));
}

export type RequeuedStaleExportJob = Readonly<{
  id: string;
  userId: string;
}>;

/**
 * Re-queues `running` exports whose `updated_at` is older than the cutoff (worker likely crashed).
 * Resets listen ZIP progress and clears `bullmq_job_id` so a fresh BullMQ publish can replace Redis state.
 * `error_message` records a deterministic stale notice (truncated prior text preserved like imports).
 */
export async function requeueStaleRunningExportJobs(
  db: ExportJobDbExecutor,
  input: Readonly<{ staleAfterSeconds: number }>,
): Promise<RequeuedStaleExportJob[]> {
  const { rows } = await db.query<{ id: string; user_id: string }>(
    `update export_jobs
     set
       stage = 'queued',
       items_processed = 0,
       items_total = null,
       bullmq_job_id = null,
       error_message = left(
         'Stale running export re-queued: no progress update within '
           || cast($1::bigint as text)
           || ' seconds; listen counters reset for a clean ZIP rebuild.'
           || case
                when coalesce(nullif(trim(error_message), ''), '') <> '' then
                  E'\n\nPrevious error_message (truncated):\n'
                  || left(error_message, 1500)
                else ''
              end,
         4000
       ),
       updated_at = now()
     where stage = 'running'
       and updated_at < now() - ($1::bigint * interval '1 second')
     returning id, user_id`,
    [input.staleAfterSeconds],
  );
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
  }));
}

export async function countActiveExportJobsForUser(
  db: ExportJobDbExecutor,
  userId: string,
): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as c
     from export_jobs
     where user_id = $1::uuid
       and stage in ('queued', 'running')`,
    [userId],
  );
  const raw = rows[0]?.["c"];
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export async function createExportJob(
  db: ExportJobDbExecutor,
  input: Readonly<{ userId: string; format: ListenExportFormat }>,
): Promise<{ id: string }> {
  const { rows } = await db.query<{ id: string }>(
    `insert into export_jobs (user_id, format, stage)
     values ($1::uuid, $2::text, 'queued')
     returning id`,
    [input.userId, input.format],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error("createExportJob: missing returning id");
  }
  return { id };
}

export async function setExportJobBullmqJobId(
  db: ExportJobDbExecutor,
  input: Readonly<{ exportJobId: string; userId: string; bullmqJobId: string }>,
): Promise<void> {
  await db.query(
    `update export_jobs
     set bullmq_job_id = $3::text, updated_at = now()
     where id = $1::uuid and user_id = $2::uuid`,
    [input.exportJobId, input.userId, input.bullmqJobId],
  );
}

export async function getExportJobByIdForUser(
  db: ExportJobDbExecutor,
  input: Readonly<{ exportJobId: string; userId: string }>,
): Promise<ExportJobRecord | null> {
  const { rows } = await db.query<{
    id: string;
    user_id: string;
    format: string;
    stage: string;
    artifact_relative_path: string | null;
    artifact_expires_at: string | null;
    artifact_delivery_token: string | null;
    error_message: string | null;
    bullmq_job_id: string | null;
    items_processed: number | string;
    items_total: number | string | null;
    created_at: string;
    updated_at: string;
  }>(
    `select id, user_id, format, stage, artifact_relative_path, artifact_expires_at,
            artifact_delivery_token, error_message, bullmq_job_id, items_processed, items_total,
            created_at, updated_at
     from export_jobs
     where id = $1::uuid and user_id = $2::uuid`,
    [input.exportJobId, input.userId],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/**
 * Persists monotonic listen-row progress for an in-flight export (`stage = running` only).
 * Ignores zero-row updates when the job is not running (worker shutdown races).
 */
export async function updateExportJobListenProgress(
  db: ExportJobDbExecutor,
  input: Readonly<{ exportJobId: string; userId: string; itemsProcessed: number }>,
): Promise<void> {
  await db.query(
    `update export_jobs
     set items_processed = $3::int, updated_at = now()
     where id = $1::uuid and user_id = $2::uuid and stage = 'running'`,
    [input.exportJobId, input.userId, input.itemsProcessed],
  );
}

/** Clears listen progress for a running export (e.g. before streaming a new ZIP attempt). */
export async function resetExportJobListenProgress(
  db: ExportJobDbExecutor,
  input: Readonly<{ exportJobId: string; userId: string }>,
): Promise<void> {
  await db.query(
    `update export_jobs
     set items_processed = 0, items_total = null, updated_at = now()
     where id = $1::uuid and user_id = $2::uuid and stage = 'running'`,
    [input.exportJobId, input.userId],
  );
}

/**
 * Moves `queued` → `running`. Returns the row when this invocation won the claim.
 */
export async function tryMarkExportJobRunning(
  db: ExportJobDbExecutor,
  input: Readonly<{ exportJobId: string; userId: string }>,
): Promise<ExportJobRecord | null> {
  const { rows } = await db.query<{
    id: string;
    user_id: string;
    format: string;
    stage: string;
    artifact_relative_path: string | null;
    artifact_expires_at: string | null;
    artifact_delivery_token: string | null;
    error_message: string | null;
    bullmq_job_id: string | null;
    items_processed: number | string;
    items_total: number | string | null;
    created_at: string;
    updated_at: string;
  }>(
    `update export_jobs
     set stage = 'running',
         items_processed = 0,
         items_total = null,
         updated_at = now()
     where id = $1::uuid and user_id = $2::uuid and stage = 'queued'
     returning id, user_id, format, stage, artifact_relative_path, artifact_expires_at,
               artifact_delivery_token, error_message, bullmq_job_id, items_processed, items_total,
               created_at, updated_at`,
    [input.exportJobId, input.userId],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export type MarkExportJobCompletedResult = "updated" | "already_completed";

/**
 * Persists `running → completed` when exactly one row matches. Returns `already_completed`
 * when the row is already terminal completed (idempotent duplicate BullMQ delivery).
 * Throws if zero rows match but the row is not completed — caller must not treat that as success.
 */
export async function markExportJobCompleted(
  db: ExportJobDbExecutor,
  input: Readonly<{
    exportJobId: string;
    userId: string;
    artifactRelativePath: string;
    artifactRetentionSeconds: number;
    /** Exact number of listen rows included in the artifact (sets both progress columns). */
    finalItemsProcessed: number;
    /** Cryptographic delivery secret for `GET .../download?token=` (server-generated). */
    artifactDeliveryToken: string;
  }>,
): Promise<MarkExportJobCompletedResult> {
  const result = await db.query(
    `update export_jobs
     set stage = 'completed',
         artifact_relative_path = $3::text,
         artifact_expires_at = now() + ($4::bigint * interval '1 second'),
         artifact_delivery_token = $6::text,
         error_message = null,
         items_processed = $5::int,
         items_total = $5::int,
         updated_at = now()
     where id = $1::uuid and user_id = $2::uuid and stage = 'running'`,
    [
      input.exportJobId,
      input.userId,
      input.artifactRelativePath,
      input.artifactRetentionSeconds,
      input.finalItemsProcessed,
      input.artifactDeliveryToken,
    ],
  );
  const n = result.rowCount ?? 0;
  if (n === 1) {
    return "updated";
  }
  if (n === 0) {
    const row = await getExportJobByIdForUser(db, {
      exportJobId: input.exportJobId,
      userId: input.userId,
    });
    if (row?.stage === "completed") {
      return "already_completed";
    }
    throw new Error(
      `[export_jobs] markExportJobCompleted: expected exactly one running row (got 0; stage=${row?.stage ?? "missing"})`,
    );
  }
  throw new Error(
    `[export_jobs] markExportJobCompleted: unexpected rowCount=${String(result.rowCount)}`,
  );
}

export async function markExportJobFailed(
  db: ExportJobDbExecutor,
  input: Readonly<{ exportJobId: string; userId: string; errorMessage: string }>,
): Promise<void> {
  const result = await db.query(
    `update export_jobs
     set stage = 'failed',
         error_message = $3::text,
         updated_at = now()
     where id = $1::uuid and user_id = $2::uuid and stage in ('queued', 'running')`,
    [input.exportJobId, input.userId, input.errorMessage],
  );
  const n = result.rowCount ?? 0;
  if (n === 1) {
    return;
  }
  if (n === 0) {
    const row = await getExportJobByIdForUser(db, {
      exportJobId: input.exportJobId,
      userId: input.userId,
    });
    if (row?.stage === "failed") {
      return;
    }
    throw new Error(
      `[export_jobs] markExportJobFailed: expected queued or running row (stage=${row?.stage ?? "missing"})`,
    );
  }
  throw new Error(`[export_jobs] markExportJobFailed: unexpected rowCount=${String(result.rowCount)}`);
}

export async function markExportJobFailedWhenQueued(
  db: ExportJobDbExecutor,
  input: Readonly<{ exportJobId: string; userId: string; errorMessage: string }>,
): Promise<void> {
  const result = await db.query(
    `update export_jobs
     set stage = 'failed',
         error_message = $3::text,
         updated_at = now()
     where id = $1::uuid and user_id = $2::uuid and stage = 'queued'`,
    [input.exportJobId, input.userId, input.errorMessage],
  );
  const n = result.rowCount ?? 0;
  if (n === 1) {
    return;
  }
  if (n === 0) {
    const row = await getExportJobByIdForUser(db, {
      exportJobId: input.exportJobId,
      userId: input.userId,
    });
    if (row?.stage === "failed") {
      return;
    }
    throw new Error(
      `[export_jobs] markExportJobFailedWhenQueued: expected queued row (stage=${row?.stage ?? "missing"})`,
    );
  }
  throw new Error(
    `[export_jobs] markExportJobFailedWhenQueued: unexpected rowCount=${String(result.rowCount)}`,
  );
}

export type ClaimedExpiredListenExportArtifact = Readonly<{
  exportJobId: string;
  userId: string;
  deletedArtifactRelativePath: string;
}>;

/**
 * Atomically transitions eligible `completed` rows to `expired`, clears the artifact path,
 * and returns the relative paths that were detached so callers can delete on-disk files.
 */
export async function claimExpiredListenExportArtifacts(
  db: ExportJobDbExecutor,
  input: Readonly<{ limit: number }>,
): Promise<ClaimedExpiredListenExportArtifact[]> {
  const { rows } = await db.query<{
    id: string;
    user_id: string;
    deleted_artifact_relative_path: string;
  }>(
    `with picked as (
       select id, user_id, artifact_relative_path
       from export_jobs
       where stage = 'completed'
         and artifact_expires_at is not null
         and artifact_expires_at <= now()
         and artifact_relative_path is not null
       order by artifact_expires_at asc
       limit $1
       for update skip locked
     )
     update export_jobs e
     set stage = 'expired',
         artifact_relative_path = null,
         artifact_delivery_token = null,
         error_message = $2::text,
         updated_at = now()
     from picked p
     where e.id = p.id
     returning e.id, e.user_id, p.artifact_relative_path as deleted_artifact_relative_path`,
    [input.limit, LISTEN_EXPORT_EXPIRED_ERROR_MESSAGE],
  );
  return rows.map((r) => ({
    exportJobId: r.id,
    userId: r.user_id,
    deletedArtifactRelativePath: r.deleted_artifact_relative_path,
  }));
}
