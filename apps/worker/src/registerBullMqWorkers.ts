import { randomUUID } from "node:crypto";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import type { Pool } from "pg";
import { isRedisQueuesEnabled, type ServerEnv } from "@vs/env";
import { runWithDbPerfContext, tryEnqueueListenCatchupJobForUser } from "@vs/db";
import {
  createBullMqRedisConnection,
  extractSafeJobDataFields,
  logQueueActivity,
  parseSyncWorkerJob,
  summarizeFailure,
  VsInvalidJobPayloadError,
  VS_QUEUE_NAMES,
} from "@vs/queue";

import { processAnalyticsJob } from "./analyticsQueueProcessor.js";
import { bullMqQueueWorkerConfigFromEnv } from "./bullmqWorkerConfig.js";
import { enqueueIncrementalSyncJobsForImportRows } from "./enqueueIncrementalSyncJobs.js";
import { processExportsJob } from "./exportQueueProcessor.js";
import { processImportsJob } from "./importQueueProcessor.js";
import { processIncrementalSyncJob } from "./incrementalSyncQueueProcessor.js";
import { throwIfListenCatchupNotEnqueued } from "./listenCatchupBullMq.js";

function asInvalidPayloadFailure(err: unknown): UnrecoverableError {
  if (err instanceof VsInvalidJobPayloadError) {
    return new UnrecoverableError(err.message);
  }
  throw err;
}

async function processSmokeTestJob(_job: Job<{ at: string }>): Promise<void> {
  return;
}

async function processSyncJob(
  job: Job,
  pool: Pool,
  env: ServerEnv,
): Promise<void> {
  let spec;
  try {
    spec = parseSyncWorkerJob(job);
  } catch (err) {
    throw asInvalidPayloadFailure(err);
  }

  const out = await tryEnqueueListenCatchupJobForUser(pool, {
    userId: spec.data.userId,
    trigger: spec.data.trigger,
    minIntervalSeconds: env.LISTEN_SYNC_USER_MIN_INTERVAL_SEC,
    workerHasSharedLastfmApiKey: Boolean(env.LASTFM_API_KEY),
  });
  throwIfListenCatchupNotEnqueued(out, {
    bullmqJobId: String(job.id),
    userId: spec.data.userId,
    trigger: spec.data.trigger,
  });
  await enqueueIncrementalSyncJobsForImportRows(env, [
    { id: out.importJobId, userId: spec.data.userId },
  ]);
}

function wrapQueueProcessor(
  queueName: string,
  processor: (job: Job) => Promise<void>,
): (job: Job) => Promise<void> {
  return async (job) => {
    const bullmqJobId = String(job.id);
    const ids = extractSafeJobDataFields(job.data);
    logQueueActivity({
      level: "info",
      event: "job_started",
      queue: queueName,
      bullmqJobId,
      jobName: job.name,
      ...ids,
    });
    try {
      await runWithDbPerfContext(
        {
          source: `job:${queueName}/${job.name}/${bullmqJobId}`,
          sourceKind: "job",
          traceId: randomUUID(),
        },
        () => processor(job),
      );
      logQueueActivity({
        level: "info",
        event: "job_completed",
        queue: queueName,
        bullmqJobId,
        jobName: job.name,
        ...ids,
      });
    } catch (err) {
      logQueueActivity({
        level: "error",
        event: "job_failed",
        queue: queueName,
        bullmqJobId,
        jobName: job.name,
        ...ids,
        failure: summarizeFailure(err),
      });
      throw err;
    }
  };
}

function attachWorkerErrorLogging(worker: Worker, queueName: string): void {
  worker.on("error", (err) => {
    logQueueActivity({
      level: "error",
      event: "worker_bullmq_runtime_error",
      queue: queueName,
      failure: summarizeFailure(err),
    });
  });
}

export function registerBullMqWorkers(
  env: ServerEnv,
  pool: Pool,
): {
  workers: Worker[];
  logActiveQueues: () => void;
  closeAll: () => Promise<void>;
} {
  if (!isRedisQueuesEnabled(env)) {
    return {
      workers: [],
      logActiveQueues() {
        console.log(
          "[worker] BullMQ workers not registered (FEATURE_FLAGS skipRedisQueues).",
        );
      },
      async closeAll() {
        /* no-op */
      },
    };
  }

  const workers: Worker[] = [];
  const queueWorkerConfig = bullMqQueueWorkerConfigFromEnv(env);

  const byQueue = {
    [VS_QUEUE_NAMES.SMOKE_TEST]: (job: Job) => processSmokeTestJob(job),
    [VS_QUEUE_NAMES.IMPORTS]: (job: Job) => processImportsJob(job, pool, env),
    [VS_QUEUE_NAMES.EXPORTS]: (job: Job) => processExportsJob(job, pool, env),
    [VS_QUEUE_NAMES.ANALYTICS]: (job: Job) => processAnalyticsJob(job, pool, env),
    [VS_QUEUE_NAMES.SYNC]: (job: Job) => processSyncJob(job, pool, env),
    [VS_QUEUE_NAMES.INCREMENTAL_SYNC]: (job: Job) =>
      processIncrementalSyncJob(job, pool, env),
  } as const;

  for (const { queueName, concurrency } of queueWorkerConfig) {
    const processor = byQueue[queueName];
    const worker = new Worker(queueName, wrapQueueProcessor(queueName, processor), {
      connection: createBullMqRedisConnection(env),
      concurrency,
    });
    attachWorkerErrorLogging(worker, queueName);
    workers.push(worker);
  }

  return {
    workers,
    logActiveQueues() {
      const parts = queueWorkerConfig.map(
        (c) => `${c.queueName}(concurrency=${c.concurrency})`,
      );
      logQueueActivity({
        level: "info",
        event: "worker_bullmq_concurrency_config",
        queue: "_worker",
        detail: { concurrency_summary: parts.join(", ") },
      });
    },
    async closeAll() {
      await Promise.all(workers.map((w) => w.close()));
    },
  };
}
