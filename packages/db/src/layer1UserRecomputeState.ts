import { LAYER1_ACTIVE_SIGNAL_VERSION } from "@vs/domain";
import type { DashboardAnalyticsDbExecutor } from "./dashboardAnalytics.js";
import {
  layer1InputWatermarksEqual,
  mergeLayer1InputWatermarkParts,
} from "./layer1InputWatermark.js";
import { sanitizeLayer1RecomputeFailureMessageForPersistence } from "./layer1RecomputeFailureSanitize.js";

export type Layer1UserRecomputePersistedStatus =
  | "never_computed"
  | "queued"
  | "running"
  | "fresh"
  | "stale"
  | "failed"
  | "failed_exhausted";

export type Layer1UserRecomputeStateRow = Readonly<{
  userId: string;
  status: Layer1UserRecomputePersistedStatus;
  signalVersion: string;
  inputWatermark: Date | null;
  lastEnqueuedAt: Date | null;
  lastStartedAt: Date | null;
  lastSucceededAt: Date | null;
  lastFailedAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
  consecutiveFailureCount: number;
  createdAt: Date;
  updatedAt: Date;
}>;

function parseRow(r: Record<string, unknown>): Layer1UserRecomputeStateRow {
  const cfc = r.consecutive_failure_count;
  return {
    userId: String(r.user_id),
    status: r.status as Layer1UserRecomputePersistedStatus,
    signalVersion: String(r.signal_version),
    inputWatermark: r.input_watermark != null ? new Date(String(r.input_watermark)) : null,
    lastEnqueuedAt: r.last_enqueued_at != null ? new Date(String(r.last_enqueued_at)) : null,
    lastStartedAt: r.last_started_at != null ? new Date(String(r.last_started_at)) : null,
    lastSucceededAt: r.last_succeeded_at != null ? new Date(String(r.last_succeeded_at)) : null,
    lastFailedAt: r.last_failed_at != null ? new Date(String(r.last_failed_at)) : null,
    failureCode: r.failure_code != null ? String(r.failure_code) : null,
    failureMessage: r.failure_message != null ? String(r.failure_message) : null,
    consecutiveFailureCount:
      typeof cfc === "number" && Number.isFinite(cfc) ? Math.trunc(cfc) : Number.parseInt(String(cfc), 10) || 0,
    createdAt: new Date(String(r.created_at)),
    updatedAt: new Date(String(r.updated_at)),
  };
}

/**
 * Marks users as `queued` and bumps `last_enqueued_at` when a Layer 1 recompute job
 * begins (after scope resolution). Idempotent for users already `running`.
 */
export async function upsertLayer1UserRecomputeQueuedForUsers(
  db: DashboardAnalyticsDbExecutor,
  userIds: readonly string[],
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }
  await db.query(
    `insert into layer1_user_recompute_state (
       user_id,
       status,
       signal_version,
       last_enqueued_at,
       updated_at
     )
     select x.uid::uuid,
            'queued',
            $2::text,
            now(),
            now()
       from unnest($1::text[]) as x(uid)
      on conflict (user_id) do update set
        status = case
          when layer1_user_recompute_state.status = 'running' then layer1_user_recompute_state.status
          else 'queued'
        end,
        signal_version = excluded.signal_version,
        last_enqueued_at = now(),
        updated_at = now()`,
    [userIds, LAYER1_ACTIVE_SIGNAL_VERSION],
  );
}

export async function markLayer1UserRecomputeRunning(
  db: DashboardAnalyticsDbExecutor,
  userId: string,
): Promise<void> {
  await db.query(
    `update layer1_user_recompute_state
        set status = 'running',
            last_started_at = now(),
            updated_at = now()
      where user_id = $1::uuid`,
    [userId],
  );
}

/**
 * Deterministic Layer 1 input frontier for `userId`: greatest of
 * `max(listens.played_at)`, `max(listens.created_at)`, and
 * `max(import_jobs.updated_at)` for `stage = 'completed'`.
 *
 * Callers comparing this to `layer1_user_recompute_state.input_watermark` with
 * `resolveLayer1UserRecomputeEffectiveStatus` stay aligned with persisted recompute inputs.
 */
export async function queryLayer1InputWatermarkForUser(
  db: DashboardAnalyticsDbExecutor,
  userId: string,
): Promise<Date | null> {
  const { rows } = await db.query<{
    max_played_at: Date | null;
    max_listen_created_at: Date | null;
    max_import_completed_at: Date | null;
  }>(
    `select
      (select max(l.played_at) from listens l where l.user_id = $1::uuid) as max_played_at,
      (select max(l.created_at) from listens l where l.user_id = $1::uuid) as max_listen_created_at,
      (select max(ij.updated_at)
         from import_jobs ij
        where ij.user_id = $1::uuid
          and ij.stage = 'completed') as max_import_completed_at`,
    [userId],
  );
  const r = rows[0];
  if (r == null) {
    return null;
  }
  return mergeLayer1InputWatermarkParts({
    maxPlayedAt: r.max_played_at != null ? new Date(String(r.max_played_at)) : null,
    maxListenCreatedAt:
      r.max_listen_created_at != null ? new Date(String(r.max_listen_created_at)) : null,
    maxImportCompletedAt:
      r.max_import_completed_at != null ? new Date(String(r.max_import_completed_at)) : null,
  });
}

/**
 * When true, the Layer 1 evidence recompute job may skip per-user materialization
 * because persisted state already matches the active signal version and current
 * input watermark after a prior success.
 */
export function shouldSkipLayer1UserEvidenceRecompute(
  row: Layer1UserRecomputeStateRow | null,
  currentInputWatermark: Date | null,
): boolean {
  if (row == null) {
    return false;
  }
  if (
    row.status === "failed" ||
    row.status === "failed_exhausted" ||
    row.status === "stale" ||
    row.status === "running"
  ) {
    return false;
  }
  if (row.lastSucceededAt == null) {
    return false;
  }
  if (row.signalVersion !== LAYER1_ACTIVE_SIGNAL_VERSION) {
    return false;
  }
  return layer1InputWatermarksEqual(row.inputWatermark, currentInputWatermark);
}

/**
 * Idempotent queue exit: sets `fresh` and watermark/version without bumping
 * `last_succeeded_at` (no new evidence materialization).
 */
export async function acknowledgeLayer1UserRecomputeStillFresh(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{ userId: string; inputWatermark: Date | null }>,
): Promise<void> {
  await db.query(
    `update layer1_user_recompute_state
        set status = 'fresh',
            signal_version = $2::text,
            input_watermark = $3::timestamptz,
            consecutive_failure_count = 0,
            updated_at = now()
      where user_id = $1::uuid`,
    [input.userId, LAYER1_ACTIVE_SIGNAL_VERSION, input.inputWatermark],
  );
}

export async function finalizeLayer1UserRecomputeFresh(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{ userId: string; inputWatermark: Date | null }>,
): Promise<void> {
  await db.query(
    `update layer1_user_recompute_state
        set status = 'fresh',
            signal_version = $2::text,
            input_watermark = $3::timestamptz,
            last_succeeded_at = now(),
            failure_code = null,
            failure_message = null,
            consecutive_failure_count = 0,
            updated_at = now()
      where user_id = $1::uuid`,
    [input.userId, LAYER1_ACTIVE_SIGNAL_VERSION, input.inputWatermark],
  );
}

export async function finalizeLayer1UserRecomputeNeverComputed(
  db: DashboardAnalyticsDbExecutor,
  userId: string,
): Promise<void> {
  await db.query(
    `update layer1_user_recompute_state
        set status = 'never_computed',
            input_watermark = null,
            last_succeeded_at = null,
            failure_code = null,
            failure_message = null,
            consecutive_failure_count = 0,
            updated_at = now()
      where user_id = $1::uuid`,
    [userId],
  );
}

export async function finalizeLayer1UserRecomputeFailed(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{
    userId: string;
    failureCode: string;
    failureMessage: string | null;
    maxConsecutiveFailures: number;
  }>,
): Promise<void> {
  const sanitized = sanitizeLayer1RecomputeFailureMessageForPersistence(
    input.failureMessage,
    input.failureCode,
  );
  const msg =
    sanitized != null && sanitized.length > 4000
      ? `${sanitized.slice(0, 3990)}…[truncated]`
      : sanitized;
  await db.query(
    `update layer1_user_recompute_state
        set consecutive_failure_count = layer1_user_recompute_state.consecutive_failure_count + 1,
            status = case
              when layer1_user_recompute_state.consecutive_failure_count + 1 >= $4::int
              then 'failed_exhausted'::text
              else 'failed'::text
            end,
            last_failed_at = now(),
            failure_code = $2::text,
            failure_message = $3::text,
            updated_at = now()
      where user_id = $1::uuid`,
    [input.userId, input.failureCode, msg, input.maxConsecutiveFailures],
  );
}

/**
 * Clears VS-84 exhaustion so operator or internal producers may enqueue another full retry
 * budget. No-ops when the row is absent or not `failed_exhausted`.
 */
export async function resetLayer1UserRecomputeRetryBudgetFromExhausted(
  db: DashboardAnalyticsDbExecutor,
  userId: string,
): Promise<void> {
  await db.query(
    `update layer1_user_recompute_state
        set status = 'failed',
            consecutive_failure_count = 0,
            updated_at = now()
      where user_id = $1::uuid
        and status = 'failed_exhausted'`,
    [userId],
  );
}

export async function getLayer1UserRecomputeStateRow(
  db: DashboardAnalyticsDbExecutor,
  userId: string,
): Promise<Layer1UserRecomputeStateRow | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    `select
       user_id::text as user_id,
       status,
       signal_version,
       input_watermark,
       last_enqueued_at,
       last_started_at,
       last_succeeded_at,
       last_failed_at,
       failure_code,
       failure_message,
       consecutive_failure_count,
       created_at,
       updated_at
       from layer1_user_recompute_state
      where user_id = $1::uuid`,
    [userId],
  );
  const r = rows[0];
  return r ? parseRow(r) : null;
}

/**
 * Derives whether Layer 1 outputs are **fresh** for the user's current Layer 1 input
 * watermark (see {@link queryLayer1InputWatermarkForUser}) and active signal version.
 * Does not write `stale` to the database; callers may persist `stale` when they want
 * explicit operator-visible staleness without recomputing.
 */
export function resolveLayer1UserRecomputeEffectiveStatus(
  row: Layer1UserRecomputeStateRow | null,
  input: Readonly<{
    currentInputWatermark: Date | null;
    activeSignalVersion?: string;
  }>,
): Layer1UserRecomputePersistedStatus {
  if (row == null) {
    return "never_computed";
  }
  const active = input.activeSignalVersion ?? LAYER1_ACTIVE_SIGNAL_VERSION;
  if (
    row.status === "queued" ||
    row.status === "running" ||
    row.status === "failed" ||
    row.status === "failed_exhausted"
  ) {
    return row.status;
  }
  if (row.status === "stale" || row.status === "never_computed") {
    return row.status;
  }
  if (row.status !== "fresh") {
    return row.status;
  }
  // status === 'fresh'
  if (row.signalVersion !== active) {
    return "stale";
  }
  const cur = input.currentInputWatermark;
  const stored = row.inputWatermark;
  if (cur == null && stored == null) {
    return "fresh";
  }
  if (cur != null && stored == null) {
    return "stale";
  }
  if (cur != null && stored != null && cur.getTime() > stored.getTime()) {
    return "stale";
  }
  return "fresh";
}

export { LAYER1_ACTIVE_SIGNAL_VERSION };
