import {
  requeueStaleRunningExportJobs,
  setExportJobBullmqJobId,
} from "@vs/db";
import type { Pool } from "pg";
import { isRedisQueuesEnabled, type ServerEnv } from "@vs/env";
import {
  createExportsQueue,
  enqueueExportsJob,
  EXPORTS_QUEUE_JOB_NAME,
} from "@vs/queue";

import { DEFAULT_STALE_RUNNING_PIPELINE_SECONDS } from "./importBackoff.js";

/**
 * Detects orphaned `export_jobs` rows stuck in `running`, moves them back to `queued`
 * with reset listen counters, then republishes BullMQ `exports` work using the same
 * `jobId` contract as `POST /api/export/listens` (export row UUID).
 */
export async function runExportStaleRecoveryTick(
  pool: Pool,
  env: ServerEnv,
): Promise<void> {
  const staleRows = await requeueStaleRunningExportJobs(pool, {
    staleAfterSeconds: DEFAULT_STALE_RUNNING_PIPELINE_SECONDS,
  });
  if (staleRows.length > 0) {
    console.log(
      `[worker] re-queued ${staleRows.length} stale running export job(s)`,
    );
  }
  if (staleRows.length === 0) {
    return;
  }
  if (!isRedisQueuesEnabled(env)) {
    console.warn(
      "[worker] skipRedisQueues: stale export rows were reset in Postgres but not republished to BullMQ.",
    );
    return;
  }

  const queue = createExportsQueue(env);
  try {
    for (const row of staleRows) {
      try {
        const job = await enqueueExportsJob(
          queue,
          {
            name: EXPORTS_QUEUE_JOB_NAME.USER_DATA_PACKAGE,
            data: { exportJobId: row.id, userId: row.userId },
          },
          { jobId: row.id },
        );
        await setExportJobBullmqJobId(pool, {
          exportJobId: row.id,
          userId: row.userId,
          bullmqJobId: String(job.id),
        });
        console.log(
          `[worker] re-enqueued BullMQ exports job for stale export id=${row.id}`,
        );
      } catch (err) {
        console.error(
          `[worker] failed to re-enqueue BullMQ exports job for stale export id=${row.id}:`,
          err,
        );
      }
    }
  } finally {
    await queue.close();
  }
}
