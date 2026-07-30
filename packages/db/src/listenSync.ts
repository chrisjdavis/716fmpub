import type { Pool, PoolClient } from "pg";
import {
  queryImportIngestFingerprintForUser,
  queryListenFingerprintAggregateForUser,
  resolveListenFingerprintSnapshotRead,
} from "./listenFingerprintReadModel.js";

type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export type ListenSyncSummaryForUser = Readonly<{
  /** When the worker last tried to enqueue a background sync for this account (may be null). */
  lastListenSyncAttemptAt: string | null;
  /** Queued or running `system_sync` jobs for this user. */
  pendingBackgroundJobs: number;
  /** Most recent `updated_at` on any `system_sync` job for this user, any terminal or active stage. */
  lastBackgroundJobUpdatedAt: string | null;
}>;

/**
 * Stable SQL for {@link getListenSyncSummaryForUser}. Exported so plan-audit tests can
 * `EXPLAIN` the exact statement production runs.
 */
export const LISTEN_SYNC_SUMMARY_FOR_USER_SQL = `select
       u.last_listen_sync_attempt_at,
       (select count(*)::int
        from import_jobs ij
        where ij.user_id = u.id
          and ij.source = 'system_sync'
          and ij.stage in ('queued', 'running')) as pending_background,
       (select max(ij.updated_at)
        from import_jobs ij
        where ij.user_id = u.id
          and ij.source = 'system_sync') as last_bg_updated
     from users u
     where u.id = $1::uuid
     limit 1`;

/**
 * One round-trip summary for the imports / settings UI (background sync pipeline).
 */
export async function getListenSyncSummaryForUser(
  db: Db,
  userId: string,
): Promise<ListenSyncSummaryForUser | null> {
  const { rows } = await db.query<{
    last_listen_sync_attempt_at: string | null;
    pending_background: string | number | null;
    last_bg_updated: string | null;
  }>(LISTEN_SYNC_SUMMARY_FOR_USER_SQL, [userId]);
  const row = rows[0];
  if (!row) {
    return null;
  }
  const pendingRaw = row.pending_background;
  const pending =
    typeof pendingRaw === "number"
      ? pendingRaw
      : typeof pendingRaw === "string"
        ? Number(pendingRaw)
        : 0;
  return {
    lastListenSyncAttemptAt: row.last_listen_sync_attempt_at
      ? String(row.last_listen_sync_attempt_at)
      : null,
    pendingBackgroundJobs: Number.isFinite(pending) ? pending : 0,
    lastBackgroundJobUpdatedAt: row.last_bg_updated
      ? String(row.last_bg_updated)
      : null,
  };
}

/**
 * Lower bound (inclusive) for Last.fm `from` on incremental sync: newest stored listen
 * epoch seconds minus `overlapSec`, or `null` when the user has no canonical listens.
 */
export async function getListenSyncFromUnixBound(
  db: Db,
  input: { userId: string; overlapSec: number },
): Promise<number | null> {
  const { rows } = await db.query<{ max_epoch: string | null }>(
    `select floor(extract(epoch from max(l.played_at)))::bigint as max_epoch
     from listens l
     where l.user_id = $1::uuid`,
    [input.userId],
  );
  const raw = rows[0]?.max_epoch;
  if (raw === null || raw === undefined) {
    return null;
  }
  const maxEpoch = Number(raw);
  if (!Number.isFinite(maxEpoch)) {
    return null;
  }
  const fromUnix = Math.floor(maxEpoch) - input.overlapSec;
  return fromUnix > 0 ? fromUnix : 0;
}

export type ListenFingerprint = Readonly<{
  max_played_at: string | null;
  listen_count: string;
}>;

/**
 * {@link ListenFingerprint} plus an explicit read-model label for operators and clients
 * (no inference of freshness from values alone).
 */
export type ListenFingerprintForApi = ListenFingerprint &
  Readonly<{
    fingerprint_read_model: "snapshot_fresh" | "canonical_listens";
    /** See {@link queryImportIngestFingerprintForUser}. */
    ingest_raw_rows: string;
    import_job_touch: string | null;
  }>;

/**
 * Fingerprint for “did canonical listens change?” — prefers the `listen_fingerprint_v1`
 * snapshot when fresh (written by `windowed_aggregate` alongside `dashboard_bundle_v1`),
 * otherwise a single live aggregate over `listens` (authoritative when the snapshot is
 * missing, invalid, or stale).
 */
export async function getListenFingerprintForUser(
  db: Db,
  userId: string,
): Promise<ListenFingerprintForApi> {
  const [resolved, ingest] = await Promise.all([
    resolveListenFingerprintSnapshotRead(db, userId),
    queryImportIngestFingerprintForUser(db, userId),
  ]);
  if (resolved.status === "fresh") {
    const s = resolved.snapshot;
    return {
      max_played_at: s.max_played_at,
      listen_count: s.listen_count,
      fingerprint_read_model: "snapshot_fresh",
      ...ingest,
    };
  }
  const live = await queryListenFingerprintAggregateForUser(db, userId);
  return { ...live, fingerprint_read_model: "canonical_listens", ...ingest };
}

/**
 * Enqueues at most one `system_sync` import job for the next eligible user and stamps
 * `users.last_listen_sync_attempt_at`. Returns whether a row was inserted.
 *
 * Only picks users who can call Last.fm: they saved `users.lastfm_api_key`, or the worker
 * has a shared key (`workerHasSharedLastfmApiKey`). Otherwise the import worker would fail
 * the job immediately for missing credentials.
 */
export type ListenCatchupEnqueueResult =
  | { ok: true; importJobId: string }
  | { ok: false; reason: string };

/**
 * Enqueues a single `system_sync` import job for an explicit user (BullMQ
 * `listen_catchup` consumer path). Mirrors `tryEnqueueListenSyncJob` eligibility
 * except the account is fixed by `userId`. `trigger === "manual"` skips the
 * per-user `last_listen_sync_attempt_at` spacing rule so explicit user actions
 * are not throttled like the background scheduler.
 */
export async function tryEnqueueListenCatchupJobForUser(
  pool: Pick<Pool, "connect">,
  input: {
    userId: string;
    trigger: "scheduled" | "manual";
    minIntervalSeconds: number;
    workerHasSharedLastfmApiKey: boolean;
  },
): Promise<ListenCatchupEnqueueResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const { rows: userRows } = await client.query<{
      id: string;
      lastfm_username: string | null;
      lastfm_api_key: string | null;
      last_listen_sync_attempt_at: Date | string | null;
    }>(
      `select u.id, u.lastfm_username, u.lastfm_api_key, u.last_listen_sync_attempt_at
       from users u
       where u.id = $1::uuid
       for update`,
      [input.userId],
    );
    const user = userRows[0];
    if (!user) {
      await client.query("rollback");
      return { ok: false, reason: "user_not_found" };
    }

    const lfUser = String(user.lastfm_username ?? "").trim();
    if (lfUser === "") {
      await client.query("rollback");
      return { ok: false, reason: "lastfm_username_not_configured" };
    }

    const hasUserKey = String(user.lastfm_api_key ?? "").trim() !== "";
    if (!hasUserKey && !input.workerHasSharedLastfmApiKey) {
      await client.query("rollback");
      return { ok: false, reason: "no_lastfm_api_key_for_account" };
    }

    const { rows: completedRows } = await client.query<{ c: string | number }>(
      `select count(*)::int as c
       from import_jobs ij
       where ij.user_id = $1::uuid
         and ij.source = 'user'
         and ij.stage = 'completed'`,
      [input.userId],
    );
    const completedCount = Number(completedRows[0]?.["c"] ?? 0);
    if (!Number.isFinite(completedCount) || completedCount < 1) {
      await client.query("rollback");
      return { ok: false, reason: "no_completed_user_import" };
    }

    const { rows: listenRows } = await client.query<{ c: string | number }>(
      `select count(*)::int as c from listens l where l.user_id = $1::uuid`,
      [input.userId],
    );
    const listenCount = Number(listenRows[0]?.["c"] ?? 0);
    if (!Number.isFinite(listenCount) || listenCount < 1) {
      await client.query("rollback");
      return { ok: false, reason: "no_canonical_listens" };
    }

    const { rows: pendingRows } = await client.query<{ c: string | number }>(
      `select count(*)::int as c
       from import_jobs ij
       where ij.user_id = $1::uuid
         and ij.stage in ('queued', 'running')`,
      [input.userId],
    );
    const pending = Number(pendingRows[0]?.["c"] ?? 0);
    if (!Number.isFinite(pending) || pending > 0) {
      await client.query("rollback");
      return { ok: false, reason: "import_already_queued_or_running" };
    }

    if (input.trigger === "scheduled") {
      const lastAt = user.last_listen_sync_attempt_at;
      if (
        lastAt !== null &&
        lastAt !== undefined &&
        typeof input.minIntervalSeconds === "number"
      ) {
        const { rows: intervalRows } = await client.query<{ ok: boolean }>(
          `select ($1::timestamptz < now() - ($2::bigint * interval '1 second')) as ok`,
          [lastAt, input.minIntervalSeconds],
        );
        const ok = Boolean(intervalRows[0]?.ok);
        if (!ok) {
          await client.query("rollback");
          return { ok: false, reason: "listen_sync_interval_not_elapsed" };
        }
      }
    }

    await client.query(
      `update users u
       set last_listen_sync_attempt_at = now()
       where u.id = $1::uuid`,
      [input.userId],
    );

    const { rows: insertRows } = await client.query<{ id: string }>(
      `insert into import_jobs (user_id, label, lastfm_username, stage, source)
       values ($1::uuid, 'Listen sync', $2, 'queued', 'system_sync')
       returning id`,
      [input.userId, lfUser],
    );
    const id = insertRows[0]?.id;
    if (!id) {
      await client.query("rollback");
      return { ok: false, reason: "insert_failed" };
    }

    await client.query("commit");
    return { ok: true, importJobId: id };
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

export type ListenSyncSchedulerEnqueueResult =
  | { enqueued: true; importJobId: string; userId: string }
  | { enqueued: false };

export async function tryEnqueueListenSyncJob(
  pool: Pool,
  input: { minIntervalSeconds: number; workerHasSharedLastfmApiKey: boolean },
): Promise<ListenSyncSchedulerEnqueueResult> {
  const { rows } = await pool.query<{ id: string; user_id: string }>(
    `with picked as (
       select u.id
       from users u
       where coalesce(nullif(trim(u.lastfm_username), ''), '') <> ''
         and (
           coalesce(nullif(trim(u.lastfm_api_key), ''), '') <> ''
           or $2::boolean
         )
         and exists (
           select 1
           from import_jobs ij
           where ij.user_id = u.id
             and ij.source = 'user'
             and ij.stage = 'completed'
         )
         and exists (select 1 from listens l where l.user_id = u.id)
         and not exists (
           select 1
           from import_jobs ij2
           where ij2.user_id = u.id
             and ij2.stage in ('queued', 'running')
         )
         and (
           u.last_listen_sync_attempt_at is null
           or u.last_listen_sync_attempt_at < now() - ($1::bigint * interval '1 second')
         )
       order by u.last_listen_sync_attempt_at asc nulls first, u.id asc
       limit 1
       for update of u skip locked
     ),
     stamped as (
       update users u
       set last_listen_sync_attempt_at = now()
       from picked p
       where u.id = p.id
       returning u.id, u.lastfm_username
     )
     insert into import_jobs (user_id, label, lastfm_username, stage, source)
     select s.id, 'Listen sync', trim(s.lastfm_username), 'queued', 'system_sync'
     from stamped s
     returning id, user_id`,
    [input.minIntervalSeconds, input.workerHasSharedLastfmApiKey],
  );
  const row = rows[0];
  if (!row) {
    return { enqueued: false };
  }
  return {
    enqueued: true,
    importJobId: String(row.id),
    userId: String(row.user_id),
  };
}
