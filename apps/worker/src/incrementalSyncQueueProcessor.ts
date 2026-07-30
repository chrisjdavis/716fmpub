import { UnrecoverableError, type Job } from "bullmq";
import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import { getImportJobByIdForUser } from "@vs/db";
import {
  INCREMENTAL_SYNC_JOB_RUNTIME_BUDGET_MS,
  logQueueActivity,
  parseIncrementalSyncWorkerJob,
  VsInvalidJobPayloadError,
  VS_QUEUE_NAMES,
} from "@vs/queue";

import { runBullMqMarkImportJobAndPipeline } from "./bullMqImportMarkRunPipeline.js";
import { runQueuedLastfmImportWithinWallClockBudget } from "./incrementalSyncWallClockBudget.js";

function asInvalidPayloadFailure(err: unknown): UnrecoverableError {
  if (err instanceof VsInvalidJobPayloadError) {
    return new UnrecoverableError(err.message);
  }
  throw err;
}

export async function processIncrementalSyncJob(
  job: Job,
  pool: Pool,
  env: ServerEnv,
): Promise<void> {
  let spec;
  try {
    spec = parseIncrementalSyncWorkerJob(job);
  } catch (err) {
    throw asInvalidPayloadFailure(err);
  }

  const ids = { importJobId: spec.data.importJobId, userId: spec.data.userId };

  const snapshot = await getImportJobByIdForUser(pool, {
    jobId: ids.importJobId,
    userId: ids.userId,
  });
  if (!snapshot) {
    throw new UnrecoverableError(
      `incremental_sync: import job not found for BullMQ job ${String(job.id)} (importJobId=${ids.importJobId})`,
    );
  }
  if (snapshot.source !== "system_sync") {
    throw new UnrecoverableError(
      `incremental_sync queue: import ${ids.importJobId} has source=${snapshot.source} (expected system_sync)`,
    );
  }
  if (snapshot.stage === "completed" || snapshot.stage === "failed") {
    logQueueActivity({
      level: "warn",
      event: "pipeline_warn",
      queue: VS_QUEUE_NAMES.INCREMENTAL_SYNC,
      bullmqJobId: String(job.id),
      importJobId: ids.importJobId,
      userId: ids.userId,
      detail: { reason: "idempotent_ack", stage: snapshot.stage },
    });
    return;
  }

  await runBullMqMarkImportJobAndPipeline(job, pool, env, ids, {
    queueLabel: "incremental_sync",
    runPipeline: (p, e, row, trace) =>
      runQueuedLastfmImportWithinWallClockBudget(
        p,
        e,
        row,
        INCREMENTAL_SYNC_JOB_RUNTIME_BUDGET_MS,
        trace,
      ),
  });
}
