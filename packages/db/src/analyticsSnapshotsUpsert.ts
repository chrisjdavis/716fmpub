import type { Pool, PoolClient } from "pg";

/**
 * Canonical replace-upsert for `analytics_snapshots`.
 * Keep aligned with `LAYER1_ANALYTICS_ROW_RECOMPUTE_SEMANTICS` in `@vs/domain`
 * (see `analyticsSnapshotsUpsert.contract.test.ts`).
 */
export const ANALYTICS_SNAPSHOTS_REPLACE_UPSERT_SQL = `insert into analytics_snapshots (user_id, kind, body, updated_at)
     values ($1::uuid, $2, $3::jsonb, now())
     on conflict (user_id, kind) do update
       set body = excluded.body,
           updated_at = now()`;

/** Same upsert as {@link ANALYTICS_SNAPSHOTS_REPLACE_UPSERT_SQL} with `RETURNING updated_at`. */
export const ANALYTICS_SNAPSHOTS_REPLACE_UPSERT_RETURNING_UPDATED_AT_SQL = `${ANALYTICS_SNAPSHOTS_REPLACE_UPSERT_SQL}
     returning updated_at`;

export type AnalyticsSnapshotDbExecutor =
  | Pick<Pool, "query">
  | Pick<PoolClient, "query">;

export async function replaceUpsertAnalyticsSnapshot(
  db: AnalyticsSnapshotDbExecutor,
  args: Readonly<{ userId: string; kind: string; bodyJson: string }>,
): Promise<void> {
  await db.query(ANALYTICS_SNAPSHOTS_REPLACE_UPSERT_SQL, [args.userId, args.kind, args.bodyJson]);
}
