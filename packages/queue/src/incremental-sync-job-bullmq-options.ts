import type { JobsOptions } from "bullmq";

/** Fewer BullMQ attempts than `imports`: incremental work is bounded per job. */
export const INCREMENTAL_SYNC_QUEUE_MAX_ATTEMPTS = 4;

export const INCREMENTAL_SYNC_QUEUE_BACKOFF_INITIAL_MS = 2_000;

/**
 * Wall-clock **watchdog** budget (ms) per incremental worker attempt. This is not a
 * cooperative kill switch: `runQueuedLastfmImport` is raced for operator visibility
 * only (`IncrementalSyncWallClockBudgetExceededError` in the worker). BullMQ
 * `JobsOptions` in this stack does not expose a typed per-job timeout.
 */
export const INCREMENTAL_SYNC_JOB_RUNTIME_BUDGET_MS = 480_000;

export function defaultIncrementalSyncJobOptions(): JobsOptions {
  return {
    attempts: INCREMENTAL_SYNC_QUEUE_MAX_ATTEMPTS,
    backoff: {
      type: "exponential",
      delay: INCREMENTAL_SYNC_QUEUE_BACKOFF_INITIAL_MS,
    },
  };
}
