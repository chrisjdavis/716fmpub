import { tryEnqueueListenSyncJob } from "@vs/db";
import type { Pool } from "pg";
import { isRedisQueuesEnabled, type ServerEnv } from "@vs/env";

import { enqueueIncrementalSyncJobsForImportRows } from "./enqueueIncrementalSyncJobs.js";

/**
 * Enqueues at most one background `system_sync` import job for an account that can reach
 * Last.fm (saved per-user API key and/or shared `LASTFM_API_KEY` on the worker).
 * Execution is scheduled on the `incremental_sync` BullMQ queue.
 */
export async function runListenSyncEnqueueTick(
  pool: Pool,
  env: ServerEnv,
): Promise<void> {
  if (!isRedisQueuesEnabled(env)) {
    return;
  }
  const out = await tryEnqueueListenSyncJob(pool, {
    minIntervalSeconds: env.LISTEN_SYNC_USER_MIN_INTERVAL_SEC,
    workerHasSharedLastfmApiKey: Boolean(env.LASTFM_API_KEY),
  });
  if (out.enqueued) {
    await enqueueIncrementalSyncJobsForImportRows(env, [
      { id: out.importJobId, userId: out.userId },
    ]);
    console.log("[worker] enqueued listen sync job for one eligible user");
  }
}
