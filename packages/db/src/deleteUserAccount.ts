import type { Pool, PoolClient } from "pg";

type QueryablePool = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export const DELETE_USER_ACCOUNT_CONFIRM_PHRASE = "DELETE MY 716FM ACCOUNT" as const;

export type DeleteUserAccountResult = Readonly<{
  userDeleted: boolean;
  listensDeleted: number;
  rawScrobblesDeleted: number;
  importJobsDeleted: number;
  exportJobsDeleted: number;
  analyticsSnapshotsDeleted: number;
  exportArtifactRelativePaths: readonly string[];
}>;

/**
 * Deletes the `users` row for one account. User-scoped tables are intentionally
 * handled by FK cascades; this helper snapshots counts and export artifact paths
 * before the delete so callers can report impact and remove files from disk.
 */
export async function deleteUserAccount(
  pool: QueryablePool,
  userId: string,
): Promise<DeleteUserAccountResult> {
  const counts = await pool.query<{
    listens: string;
    raw_scrobbles: string;
    import_jobs: string;
    export_jobs: string;
    analytics_snapshots: string;
  }>(
    `select
       (select count(*) from listens where user_id = $1::uuid)::text as listens,
       (select count(*) from raw_scrobbles where user_id = $1::uuid)::text as raw_scrobbles,
       (select count(*) from import_jobs where user_id = $1::uuid)::text as import_jobs,
       (select count(*) from export_jobs where user_id = $1::uuid)::text as export_jobs,
       (select count(*) from analytics_snapshots where user_id = $1::uuid)::text as analytics_snapshots`,
    [userId],
  );
  const artifactRows = await pool.query<{ artifact_relative_path: string }>(
    `select artifact_relative_path
       from export_jobs
      where user_id = $1::uuid
        and artifact_relative_path is not null
        and btrim(artifact_relative_path) <> ''`,
    [userId],
  );
  const deleted = await pool.query<{ id: string }>(
    `delete from users where id = $1::uuid returning id`,
    [userId],
  );
  const row = counts.rows[0];
  return {
    userDeleted: deleted.rowCount === 1,
    listensDeleted: Number(row?.listens ?? 0),
    rawScrobblesDeleted: Number(row?.raw_scrobbles ?? 0),
    importJobsDeleted: Number(row?.import_jobs ?? 0),
    exportJobsDeleted: Number(row?.export_jobs ?? 0),
    analyticsSnapshotsDeleted: Number(row?.analytics_snapshots ?? 0),
    exportArtifactRelativePaths: artifactRows.rows.map((r) => r.artifact_relative_path),
  };
}
