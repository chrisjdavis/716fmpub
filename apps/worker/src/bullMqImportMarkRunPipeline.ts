import { UnrecoverableError, type Job } from "bullmq";
import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import {
  getImportJobByIdForUser,
  markImportJobRunning,
  requeueRunningImportJobForBullMqRetry,
  type ImportJobRecord,
} from "@vs/db";
import { logQueueActivity, summarizeFailure, type QueueJobTrace } from "@vs/queue";

/**
 * Aligns `import_jobs` with BullMQ retries after an unexpected pipeline throw.
 * `UnrecoverableError` is never re-queued — terminal BullMQ contract.
 */
export async function recoverAfterBullMqLastfmImportThrow(
  pool: Pool,
  input: { importJobId: string; userId: string },
  err: unknown,
  queueLabel: string,
  bullmqJobId: string,
): Promise<void> {
  if (err instanceof UnrecoverableError) {
    throw err;
  }
  const row = await getImportJobByIdForUser(pool, {
    jobId: input.importJobId,
    userId: input.userId,
  });
  if (row?.stage === "completed" || row?.stage === "failed") {
    return;
  }
  if (row?.stage === "running") {
    const rq = await requeueRunningImportJobForBullMqRetry(pool, {
      jobId: input.importJobId,
      userId: input.userId,
    });
    if (rq) {
      logQueueActivity({
        level: "warn",
        event: "pipeline_warn",
        queue: queueLabel,
        bullmqJobId,
        importJobId: input.importJobId,
        userId: input.userId,
        detail: { reason: "requeued_for_bullmq_retry" },
        failure: summarizeFailure(err),
      });
    }
  }
  throw err;
}

/**
 * Shared BullMQ → `markImportJobRunning` → Last.fm pipeline ladder for queues
 * that enqueue `{ importJobId, userId }` against `import_jobs` rows.
 */
export async function runBullMqMarkImportJobAndPipeline(
  job: Job,
  pool: Pool,
  env: ServerEnv,
  ids: { importJobId: string; userId: string },
  opts: {
    queueLabel: string;
    runPipeline: (
      pool: Pool,
      env: ServerEnv,
      row: ImportJobRecord,
      trace: QueueJobTrace,
    ) => Promise<void>;
  },
): Promise<void> {
  const trace: QueueJobTrace = {
    queue: opts.queueLabel,
    bullmqJobId: String(job.id),
  };
  const claimed = await markImportJobRunning(pool, {
    jobId: ids.importJobId,
    userId: ids.userId,
  });
  if (claimed) {
    try {
      await opts.runPipeline(pool, env, claimed, trace);
    } catch (err) {
      await recoverAfterBullMqLastfmImportThrow(pool, ids, err, opts.queueLabel, trace.bullmqJobId);
    }
    return;
  }

  const existing = await getImportJobByIdForUser(pool, {
    jobId: ids.importJobId,
    userId: ids.userId,
  });
  if (!existing) {
    throw new UnrecoverableError(
      `${opts.queueLabel}: import job not found for BullMQ job ${String(job.id)} (importJobId=${ids.importJobId})`,
    );
  }
  if (existing.stage === "completed" || existing.stage === "failed") {
    logQueueActivity({
      level: "warn",
      event: "pipeline_warn",
      queue: opts.queueLabel,
      bullmqJobId: trace.bullmqJobId,
      importJobId: ids.importJobId,
      userId: ids.userId,
      detail: { reason: "idempotent_ack", stage: existing.stage },
    });
    return;
  }
  if (existing.stage === "running") {
    logQueueActivity({
      level: "warn",
      event: "pipeline_warn",
      queue: opts.queueLabel,
      bullmqJobId: trace.bullmqJobId,
      importJobId: ids.importJobId,
      userId: ids.userId,
      detail: { reason: "skipped_already_running_elsewhere" },
    });
    return;
  }

  const retry = await markImportJobRunning(pool, {
    jobId: ids.importJobId,
    userId: ids.userId,
  });
  if (retry) {
    try {
      await opts.runPipeline(pool, env, retry, trace);
    } catch (err) {
      await recoverAfterBullMqLastfmImportThrow(pool, ids, err, opts.queueLabel, trace.bullmqJobId);
    }
    return;
  }

  const finalRow = await getImportJobByIdForUser(pool, {
    jobId: ids.importJobId,
    userId: ids.userId,
  });
  throw new UnrecoverableError(
    `${opts.queueLabel}: import ${ids.importJobId} could not be claimed after retry (BullMQ job ${String(job.id)}, stage=${finalRow?.stage ?? "missing"})`,
  );
}
