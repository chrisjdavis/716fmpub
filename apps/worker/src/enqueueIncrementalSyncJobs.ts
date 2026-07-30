import { isRedisQueuesEnabled, type ServerEnv } from "@vs/env";
import {
  createIncrementalSyncQueue,
  enqueueIncrementalSyncJob,
  INCREMENTAL_SYNC_QUEUE_JOB_NAME,
} from "@vs/queue";

/**
 * Publishes BullMQ `incremental_sync` jobs for queued `system_sync` import rows.
 * Rows stay `queued` until the incremental worker claims them via `markImportJobRunning`.
 */
export async function enqueueIncrementalSyncJobsForImportRows(
  env: ServerEnv,
  rows: ReadonlyArray<{ id: string; userId: string }>,
): Promise<void> {
  if (!isRedisQueuesEnabled(env) || rows.length === 0) {
    return;
  }
  const queue = createIncrementalSyncQueue(env);
  try {
    for (const row of rows) {
      await enqueueIncrementalSyncJob(queue, {
        name: INCREMENTAL_SYNC_QUEUE_JOB_NAME.SYSTEM_SYNC_RUN,
        data: { importJobId: row.id, userId: row.userId },
      });
    }
  } finally {
    await queue.close();
  }
}
