import type { Pool, PoolClient } from "pg";
import { replaceUpsertAnalyticsSnapshot } from "./analyticsSnapshotsUpsert.js";
import { pgTimestamptzToIsoOrNull } from "./pgTimestamptz.js";

/** Executor shape for snapshot reads (matches `DashboardAnalyticsDbExecutor` in dashboardAnalytics). */
type SnapshotDb = Pick<Pool, "query">;

/**
 * Pool or transaction client: live fingerprint reads run inside either.
 * Callers must supply a `pg`-compatible `query` implementation (same contract as `Pool["query"]`).
 */
export type ListenFingerprintAggregateDb = Pick<Pool, "query"> | Pick<PoolClient, "query">;

/** Precomputed listen fingerprint rows upserted by {@link recomputeDashboardAnalyticsBundle}. */
export const LISTEN_FINGERPRINT_SNAPSHOT_KIND = "listen_fingerprint_v1" as const;

const LISTEN_FINGERPRINT_SNAPSHOT_SCHEMA_VERSION = 1;

export type ListenFingerprintSnapshotBodyV1 = {
  schema_version: typeof LISTEN_FINGERPRINT_SNAPSHOT_SCHEMA_VERSION;
  as_of: string;
  max_played_at: string | null;
  listen_count: string;
};

export type ResolveListenFingerprintSnapshotResult =
  | { status: "fresh"; snapshot: ListenFingerprintSnapshotBodyV1 }
  | { status: "missing" }
  | { status: "invalid_body" }
  | { status: "stale"; snapshot_as_of: string };

export function parseListenFingerprintSnapshotBodyV1(
  raw: unknown,
): ListenFingerprintSnapshotBodyV1 | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (o.schema_version !== LISTEN_FINGERPRINT_SNAPSHOT_SCHEMA_VERSION) {
    return null;
  }
  if (typeof o.as_of !== "string" || o.as_of.trim() === "") {
    return null;
  }
  if (o.max_played_at !== null && typeof o.max_played_at !== "string") {
    return null;
  }
  if (typeof o.listen_count !== "string" || o.listen_count.trim() === "") {
    return null;
  }
  return {
    schema_version: LISTEN_FINGERPRINT_SNAPSHOT_SCHEMA_VERSION,
    as_of: o.as_of,
    max_played_at: o.max_played_at as string | null,
    listen_count: o.listen_count,
  };
}

/**
 * Upserts {@link LISTEN_FINGERPRINT_SNAPSHOT_KIND}. `as_of` is derived from `nowMs` (UTC)
 * so staleness probes align with {@link resolveDashboardAnalyticsBundleRead}.
 */
export async function upsertListenFingerprintSnapshot(
  db: SnapshotDb,
  input: {
    userId: string;
    nowMs: number;
    max_played_at: string | null;
    listen_count: string;
  },
): Promise<void> {
  const { userId, nowMs, max_played_at, listen_count } = input;
  const body: ListenFingerprintSnapshotBodyV1 = {
    schema_version: LISTEN_FINGERPRINT_SNAPSHOT_SCHEMA_VERSION,
    as_of: new Date(nowMs).toISOString(),
    max_played_at,
    listen_count,
  };
  await replaceUpsertAnalyticsSnapshot(db, {
    userId,
    kind: LISTEN_FINGERPRINT_SNAPSHOT_KIND,
    bodyJson: JSON.stringify(body),
  });
}

/**
 * Resolves the fingerprint snapshot: missing, invalid JSON, stale (any listen with
 * `played_at` strictly after `as_of`), or fresh.
 *
 * **Freshness:** same `played_at > as_of` rule as `dashboard_bundle_v1` — deletes that
 * do not advance `max(played_at)` can leave a row that still reads fresh while totals
 * disagree; callers treat the snapshot as best-effort.
 *
 * **Count drift:** historical imports often insert listens with `played_at` at or before the
 * snapshot `as_of`, so the time-based stale probe alone misses them. When the live row count
 * disagrees with the snapshot body, the snapshot is treated as stale so clients (fingerprint
 * poller, dashboards) observe changes.
 */
export async function resolveListenFingerprintSnapshotRead(
  db: SnapshotDb,
  userId: string,
): Promise<ResolveListenFingerprintSnapshotResult> {
  const { rows } = await db.query<{ body: unknown }>(
    `select body from analytics_snapshots
     where user_id = $1::uuid and kind = $2`,
    [userId, LISTEN_FINGERPRINT_SNAPSHOT_KIND],
  );
  const row = rows[0];
  if (!row) {
    return { status: "missing" };
  }
  const parsed = parseListenFingerprintSnapshotBodyV1(row.body);
  if (!parsed) {
    console.warn(
      `[vs-db:analytics_snapshots] invalid_body user_id=${userId} kind=${LISTEN_FINGERPRINT_SNAPSHOT_KIND}`,
    );
    return { status: "invalid_body" };
  }
  const { rows: staleRows } = await db.query<{ x: boolean }>(
    `select exists(
       select 1 from listens l
        where l.user_id = $1::uuid
          and l.played_at > $2::timestamptz
        limit 1
     ) as x`,
    [userId, parsed.as_of],
  );
  if (staleRows[0]?.x === true) {
    return { status: "stale", snapshot_as_of: parsed.as_of };
  }
  const { rows: driftRows } = await db.query<{ drift: boolean }>(
    `select (
       (select count(*)::text from listens l where l.user_id = $1::uuid)
       is distinct from
       $2::text
     ) as drift`,
    [userId, parsed.listen_count],
  );
  if (driftRows[0]?.drift === true) {
    return { status: "stale", snapshot_as_of: parsed.as_of };
  }
  return { status: "fresh", snapshot: parsed };
}

export type ImportIngestFingerprint = Readonly<{
  /**
   * Raw scrobbles tied to any `import_jobs` row for this user in `queued` or `running`.
   * Non-zero while the worker ingests before canonical `listens` rows appear.
   */
  ingest_raw_rows: string;
  /** Latest `import_jobs.updated_at` among those active jobs, or null when none. */
  import_job_touch: string | null;
}>;

/**
 * Cheap import-pipeline signals merged into {@link getListenFingerprintForUser} so the dashboard
 * fingerprint poller observes ingest progress even when `listens` is still empty.
 */
export async function queryImportIngestFingerprintForUser(
  db: ListenFingerprintAggregateDb,
  userId: string,
): Promise<ImportIngestFingerprint> {
  const { rows } = await db.query<{
    ingest_raw_rows: string | number | null;
    import_job_touch: string | null;
  }>(
    `select
       (select count(*)::text
        from raw_scrobbles r
        where r.import_job_id in (
          select ij.id
          from import_jobs ij
          where ij.user_id = $1::uuid
            and ij.stage in ('queued', 'running')
        )) as ingest_raw_rows,
       (select max(ij.updated_at)::text
        from import_jobs ij
        where ij.user_id = $1::uuid
          and ij.stage in ('queued', 'running')
       ) as import_job_touch`,
    [userId],
  );
  const row = rows[0];
  const ingestRaw =
    row?.ingest_raw_rows === null || row?.ingest_raw_rows === undefined
      ? "0"
      : String(row.ingest_raw_rows);
  const touch =
    row?.import_job_touch === null || row?.import_job_touch === undefined
      ? null
      : String(row.import_job_touch);
  return { ingest_raw_rows: ingestRaw, import_job_touch: touch };
}

export async function queryListenFingerprintAggregateForUser(
  db: ListenFingerprintAggregateDb,
  userId: string,
): Promise<{ max_played_at: string | null; listen_count: string }> {
  const { rows } = await db.query<{
    max_played_at: Date | string | null;
    listen_count: string | number | null;
  }>(
    `select max(l.played_at) as max_played_at, count(*)::text as listen_count
     from listens l
     where l.user_id = $1::uuid`,
    [userId],
  );
  const r = rows[0];
  return {
    max_played_at: pgTimestamptzToIsoOrNull(r?.max_played_at ?? null),
    listen_count:
      r?.listen_count === null || r?.listen_count === undefined
        ? "0"
        : String(r.listen_count),
  };
}
