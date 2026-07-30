import type { JobsOptions, Queue } from "bullmq";
import type { ServerEnv } from "@vs/env";
import { isRedisQueuesEnabled } from "@vs/env";

import { createAnalyticsQueue } from "./domain-queues.js";
import { enqueueAnalyticsJob } from "./enqueue-validated.js";
import {
  ANALYTICS_QUEUE_JOB_NAME,
  type Layer1EvidenceRecomputeEnqueueReasonCode,
  type Layer1EvidenceRecomputePayloadInput,
  type ListenPeriodMetricsMode,
} from "./job-contracts.js";
import { logQueueActivity, summarizeFailure } from "./queue-structured-log.js";
import { VS_QUEUE_NAMES } from "./queue-names.js";

/**
 * Stable BullMQ `jobId` for per-user Layer 1 recompute jobs (no `:` — BullMQ rejects colons).
 * Duplicate `queue.add` calls with the same id coalesce to one waiting job for that user.
 */
export function layer1EvidenceRecomputeBullJobIdForUser(userId: string): string {
  return `layer1-evidence-${userId}`;
}

/**
 * Enqueues a validated `windowed_aggregate` job that drives dashboard bundle recompute
 * for one user. Uses a stable BullMQ `jobId` so Redis coalesces duplicate adds for the
 * same user (BullMQ returns the existing job id when the key already exists; it does not
 * rely on substring matching of thrown errors).
 */
export async function enqueueDashboardBundleAnalyticsJob(
  queue: Queue,
  userId: string,
  now: Date = new Date(),
  jobsOptions?: JobsOptions,
): Promise<void> {
  const windowStartIso = new Date(0).toISOString();
  const windowEndIso = now.toISOString();
  const merged: JobsOptions = {
    /** No `:` — BullMQ rejects colons in custom job ids. */
    jobId: `dashboard-bundle-${userId}`,
    removeOnComplete: true,
    ...jobsOptions,
  };
  await enqueueAnalyticsJob(
    queue,
    {
      name: ANALYTICS_QUEUE_JOB_NAME.WINDOWED_AGGREGATE,
      data: {
        windowStartIso,
        windowEndIso,
        userId,
      },
    },
    merged,
  );
}

export type EnqueueListenPeriodMetricsJobInput = Readonly<{
  mode?: ListenPeriodMetricsMode;
  jobsOptions?: JobsOptions;
}>;

/**
 * Refreshes period rollups for one user (default `incremental`: current UTC week/month/year
 * only). Uses a stable BullMQ `jobId` per mode so repeated enqueue coalesces to one pending job
 * per user.
 */
export async function enqueueListenPeriodMetricsJob(
  queue: Queue,
  userId: string,
  input?: EnqueueListenPeriodMetricsJobInput,
): Promise<void> {
  const mode = input?.mode ?? "incremental";
  const merged: JobsOptions = {
    jobId:
      mode === "full"
        ? `listen-period-metrics-full-${userId}`
        : `listen-period-metrics-${userId}`,
    removeOnComplete: true,
    ...input?.jobsOptions,
  };
  await enqueueAnalyticsJob(
    queue,
    {
      name: ANALYTICS_QUEUE_JOB_NAME.LISTEN_PERIOD_METRICS,
      data: { userId, mode },
    },
    merged,
  );
}

/** Explicit full rebuild of every calendar week/month/year bucket (separate coalesced job id). */
export async function enqueueListenPeriodMetricsFullRebuildJob(
  queue: Queue,
  userId: string,
  jobsOptions?: JobsOptions,
): Promise<void> {
  return enqueueListenPeriodMetricsJob(queue, userId, { mode: "full", jobsOptions });
}

export type EnqueueDashboardBundleAnalyticsForUserOptions = Readonly<{
  /** When set, passed to listen-period-metrics (default `incremental`). */
  listenPeriodMetricsMode?: ListenPeriodMetricsMode;
}>;

export type EnqueueLayer1EvidenceRecomputeExplicitUsersInput = Readonly<{
  userIds: readonly string[];
  enqueueReason: Layer1EvidenceRecomputeEnqueueReasonCode;
  now?: Date;
  correlationId?: string;
  actorUserId?: string;
  artistLimit?: number;
  jobsOptions?: JobsOptions;
}>;

/**
 * Enqueues {@link ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE} for one or many
 * explicit user ids (bounded by the job contract). `now` anchors the rolling 30d window.
 *
 * For exactly one user id, merges BullMQ options with {@link layer1EvidenceRecomputeBullJobIdForUser}
 * last so Redis coalesces duplicate producer calls; multi-user explicit jobs do not set a default
 * `jobId` (operator batches use distinct payloads per enqueue).
 */
export async function enqueueLayer1EvidenceRecomputeExplicitUsers(
  queue: Queue,
  input: EnqueueLayer1EvidenceRecomputeExplicitUsersInput,
): Promise<void> {
  const nowMsAnchorIso = (input.now ?? new Date()).toISOString();
  const data: Layer1EvidenceRecomputePayloadInput = {
    nowMsAnchorIso,
    scope: { kind: "explicit_user_ids", userIds: [...input.userIds] },
    enqueueReason: input.enqueueReason,
    correlationId: input.correlationId,
    actorUserId: input.actorUserId,
    artistLimit: input.artistLimit,
  };
  const singleUserId = input.userIds.length === 1 ? input.userIds[0] : undefined;
  const mergedJobsOptions: JobsOptions | undefined =
    singleUserId != null
      ? {
          removeOnComplete: true,
          ...input.jobsOptions,
          jobId: layer1EvidenceRecomputeBullJobIdForUser(singleUserId),
        }
      : input.jobsOptions;
  await enqueueAnalyticsJob(
    queue,
    {
      name: ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE,
      data,
    },
    mergedJobsOptions,
  );
}

export type EnqueueLayer1EvidenceRecomputeCursorBatchInput = Readonly<{
  cursorAfterUserId: string | null;
  limit: number;
  enqueueReason: Layer1EvidenceRecomputeEnqueueReasonCode;
  now?: Date;
  correlationId?: string;
  actorUserId?: string;
  artistLimit?: number;
  jobsOptions?: JobsOptions;
}>;

/**
 * Enqueues a bounded page of users ordered by `users.id` after `cursorAfterUserId`
 * (`null` starts after the nil UUID). Operators enqueue the next page using the last
 * id from the prior job’s resolved set or logs.
 */
export async function enqueueLayer1EvidenceRecomputeUserCursorBatch(
  queue: Queue,
  input: EnqueueLayer1EvidenceRecomputeCursorBatchInput,
): Promise<void> {
  const nowMsAnchorIso = (input.now ?? new Date()).toISOString();
  const data: Layer1EvidenceRecomputePayloadInput = {
    nowMsAnchorIso,
    scope: {
      kind: "user_cursor_batch",
      cursorAfterUserId: input.cursorAfterUserId,
      limit: input.limit,
    },
    enqueueReason: input.enqueueReason,
    correlationId: input.correlationId,
    actorUserId: input.actorUserId,
    artistLimit: input.artistLimit,
  };
  await enqueueAnalyticsJob(
    queue,
    {
      name: ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE,
      data,
    },
    input.jobsOptions,
  );
}

/**
 * Opens a short-lived analytics producer, enqueues dashboard bundle recompute, logs on
 * failure, and always closes the queue. Intended for request paths that should not fail
 * when Redis is down or enqueue rejects.
 */
export async function enqueueDashboardBundleAnalyticsForUserBestEffort(
  env: ServerEnv,
  userId: string,
  options?: EnqueueDashboardBundleAnalyticsForUserOptions,
): Promise<void> {
  if (!isRedisQueuesEnabled(env)) {
    return;
  }
  const queue = createAnalyticsQueue(env);
  try {
    try {
      await enqueueDashboardBundleAnalyticsJob(queue, userId);
    } catch (err) {
      logQueueActivity({
        level: "warn",
        event: "producer_enqueue_failed",
        queue: VS_QUEUE_NAMES.ANALYTICS,
        userId,
        detail: { step: "windowed_aggregate" },
        failure: summarizeFailure(err),
      });
    }
    try {
      await enqueueListenPeriodMetricsJob(queue, userId, {
        mode: options?.listenPeriodMetricsMode ?? "incremental",
      });
    } catch (err) {
      logQueueActivity({
        level: "warn",
        event: "producer_enqueue_failed",
        queue: VS_QUEUE_NAMES.ANALYTICS,
        userId,
        detail: { step: "listen_period_metrics" },
        failure: summarizeFailure(err),
      });
    }
  } finally {
    await queue.close();
  }
}
