/**
 * Read-only Postgres probe for durable jobs stuck in `running` without a recent
 * `updated_at` heartbeat. Does not enqueue or mutate rows.
 *
 * Stale threshold matches `DEFAULT_STALE_RUNNING_PIPELINE_SECONDS` in
 * `apps/worker/src/importBackoff.ts` unless overridden by `VS_STALLED_JOB_PROBE_SECONDS`.
 */
import {
  getPool,
  listStaleRunningExportJobs,
  listStaleRunningImportJobs,
} from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { summarizeThrowableForLog } from "@vs/sensitive";

const PREFIX = "[stalled-db-jobs]" as const;

async function main(): Promise<void> {
  const env = loadServerEnv();
  const staleAfterSeconds = env.VS_STALLED_JOB_PROBE_SECONDS ?? 600;
  const pool = getPool(env);
  const inspectedAtIso = new Date().toISOString();

  const [importRows, exportRows] = await Promise.all([
    listStaleRunningImportJobs(pool, { staleAfterSeconds }),
    listStaleRunningExportJobs(pool, { staleAfterSeconds }),
  ]);

  console.log(
    JSON.stringify({
      kind: "stalled_db_job_probe_meta",
      prefix: PREFIX,
      inspectedAtIso,
      staleAfterSeconds,
      importStaleCount: importRows.length,
      exportStaleCount: exportRows.length,
    }),
  );
  for (const row of importRows) {
    console.log(
      JSON.stringify({
        kind: "stalled_import_job",
        prefix: PREFIX,
        ...row,
      }),
    );
  }
  for (const row of exportRows) {
    console.log(
      JSON.stringify({
        kind: "stalled_export_job",
        prefix: PREFIX,
        ...row,
      }),
    );
  }

  await pool.end();
}

void main().catch((err: unknown) => {
  console.error(PREFIX, summarizeThrowableForLog(err));
  process.exit(1);
});
