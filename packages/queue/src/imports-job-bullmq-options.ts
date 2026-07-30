import type { JobsOptions } from "bullmq";

/**
 * BullMQ-level retry for `VS_QUEUE_NAMES.IMPORTS` jobs.
 *
 * **Retryable (BullMQ will retry with exponential backoff):** The processor throws
 * a normal `Error` after `requeueRunningImportJobForBullMqRetry` moves a stuck
 * `import_jobs` row from `running` back to `queued` so the next attempt can call
 * `markImportJobRunning` again. In-flight work stays idempotent via checkpoints and
 * raw row dedupe (`@vs/db` / `runQueuedLastfmImport` contract).
 *
 * **Terminal at the BullMQ layer (no further queue retries):**
 * - `UnrecoverableError` from the processor (invalid payload, contract violations).
 * - Processor returns normally while `import_jobs` is already `completed` or `failed`
 *   (including after `runQueuedLastfmImport` persisted a terminal outcome).
 *
 * **Not BullMQ retries:** Transient Last.fm / Postgres errors inside
 * `runQueuedLastfmImport` use bounded in-process backoff (`apps/worker`); those paths
 * must not rely on BullMQ for correctness.
 */
export const IMPORTS_QUEUE_MAX_ATTEMPTS = 6;

/** Initial delay (ms) before the first BullMQ retry; grows exponentially per BullMQ rules. */
export const IMPORTS_QUEUE_BACKOFF_INITIAL_MS = 3_000;

export function defaultImportsJobOptions(): JobsOptions {
  return {
    attempts: IMPORTS_QUEUE_MAX_ATTEMPTS,
    backoff: {
      type: "exponential",
      delay: IMPORTS_QUEUE_BACKOFF_INITIAL_MS,
    },
  };
}
