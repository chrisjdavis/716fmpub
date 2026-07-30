import type { Pool } from "pg";

type QueryablePool = Pick<Pool, "query">;

/**
 * Exact string required in the API body before {@link purgeUserListenData} runs.
 * Settings UI should show this so the user can copy it into the confirmation field.
 */
export const PURGE_USER_LISTEN_DATA_CONFIRM_PHRASE =
  "DELETE ALL MY LISTEN AND IMPORT DATA" as const;

export type PurgeUserListenDataResult = Readonly<{
  listensDeleted: number;
  importJobsDeleted: number;
  analyticsSnapshotsDeleted: number;
}>;

/**
 * Removes all listen-derived rows for one user: `listens`, `import_jobs` (CASCADE
 * `raw_scrobbles`), `user_listen_period_metrics`, `user_artist_listen_stats`,
 * `user_listen_daily_metrics`, and `analytics_snapshots`. Does not delete `users`, sessions,
 * profile fields, or shared
 * `tracks` / `artists` / `albums` dimension rows.
 */
export async function purgeUserListenData(
  pool: QueryablePool,
  userId: string,
): Promise<PurgeUserListenDataResult> {
  await pool.query(`delete from user_listen_period_metrics where user_id = $1::uuid`, [userId]);
  await pool.query(`delete from user_artist_listen_stats where user_id = $1::uuid`, [userId]);
  await pool.query(`delete from user_listen_daily_metrics where user_id = $1::uuid`, [userId]);
  const listens = await pool.query(`delete from listens where user_id = $1::uuid`, [userId]);
  const analytics = await pool.query(`delete from analytics_snapshots where user_id = $1::uuid`, [
    userId,
  ]);
  const jobs = await pool.query(`delete from import_jobs where user_id = $1::uuid`, [userId]);
  return {
    listensDeleted: listens.rowCount ?? 0,
    importJobsDeleted: jobs.rowCount ?? 0,
    analyticsSnapshotsDeleted: analytics.rowCount ?? 0,
  };
}
