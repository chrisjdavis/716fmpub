import {
  getPool,
  listQueuedSystemSyncImportJobsForEnqueue,
  requeueStaleRunningImportJobs,
} from "@vs/db";
import type { Pool } from "pg";
import { isRedisQueuesEnabled, type ServerEnv } from "@vs/env";
import {
  createImportsQueue,
  enqueueImportsJob,
  IMPORTS_QUEUE_JOB_NAME,
} from "@vs/queue";

import { enqueueIncrementalSyncJobsForImportRows } from "./enqueueIncrementalSyncJobs.js";
import { DEFAULT_STALE_RUNNING_IMPORT_SECONDS } from "./importBackoff.js";

/**
 * Re-queues orphaned `running` jobs, re-publishes BullMQ work for stale user imports,
 * re-publishes stale `system_sync` rows on `incremental_sync`, and idempotently enqueues
 * BullMQ work for any other queued `system_sync` rows (import tick no longer claims them).
 */
export async function runImportTick(
  pool: Pool,
  env: ServerEnv,
): Promise<void> {
  const staleRows = await requeueStaleRunningImportJobs(pool, {
    staleAfterSeconds: DEFAULT_STALE_RUNNING_IMPORT_SECONDS,
  });
  if (staleRows.length > 0) {
    console.log(
      `[worker] re-queued ${staleRows.length} stale running import job(s)`,
    );
  }

  const userStale = staleRows.filter((r) => r.source === "user");
  if (userStale.length > 0 && isRedisQueuesEnabled(env)) {
    const queue = createImportsQueue(env);
    try {
      for (const row of userStale) {
        try {
          await enqueueImportsJob(queue, {
            name: IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT,
            data: { importJobId: row.id, userId: row.userId },
          });
          console.log(
            `[worker] re-enqueued BullMQ imports job for stale user import id=${row.id}`,
          );
        } catch (err) {
          console.error(
            `[worker] failed to re-enqueue BullMQ imports job for stale user import id=${row.id}:`,
            err,
          );
        }
      }
    } finally {
      await queue.close();
    }
  }

  const systemStale = staleRows.filter((r) => r.source === "system_sync");
  const pendingSystemSync = await listQueuedSystemSyncImportJobsForEnqueue(pool, {
    limit: 20,
  });

  const incrementalPublish = new Map<string, { id: string; userId: string }>();
  for (const r of systemStale) {
    incrementalPublish.set(r.id, { id: r.id, userId: r.userId });
  }
  for (const r of pendingSystemSync) {
    incrementalPublish.set(r.id, r);
  }

  if (incrementalPublish.size > 0) {
    await enqueueIncrementalSyncJobsForImportRows(env, [...incrementalPublish.values()]);
    if (systemStale.length > 0 && isRedisQueuesEnabled(env)) {
      console.log(
        `[worker] re-enqueued ${systemStale.length} stale system_sync row(s) on incremental_sync`,
      );
    }
  }
}

export async function runImportTickFromEnv(env: ServerEnv): Promise<void> {
  const pool = getPool(env);
  await runImportTick(pool, env);
}
