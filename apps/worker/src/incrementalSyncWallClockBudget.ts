import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import type { ImportJobRecord } from "@vs/db";
import type { QueueJobTrace } from "@vs/queue";

import { runQueuedLastfmImport } from "./runQueuedLastfmImport.js";

/**
 * Raised when the incremental worker's wall-clock watchdog fires before
 * `runQueuedLastfmImport` settles. This is **not** cooperative cancellation: the
 * import coroutine keeps running until completion unless it observes its own
 * failure paths; operators must treat BullMQ `failed` here as a visibility signal
 * that this attempt stopped waiting, not proof that side effects halted.
 */
export class IncrementalSyncWallClockBudgetExceededError extends Error {
  readonly code = "INCREMENTAL_SYNC_WALL_CLOCK_BUDGET_EXCEEDED" as const;

  constructor(
    public readonly importJobId: string,
    public readonly budgetMs: number,
  ) {
    super(
      `incremental_sync wall-clock budget (${budgetMs}ms) exceeded for importJobId=${importJobId}. ` +
        "BullMQ sees failure; the Last.fm pipeline is not aborted by this race.",
    );
    this.name = "IncrementalSyncWallClockBudgetExceededError";
  }
}

/**
 * Fails the BullMQ attempt when `budgetMs` elapses without `runQueuedLastfmImport`
 * resolving. The losing branch of `Promise.race` is **not** cancelled — document
 * callers must not assume exclusive access to the row ended at rejection time.
 */
export async function runQueuedLastfmImportWithinWallClockBudget(
  pool: Pool,
  env: ServerEnv,
  job: ImportJobRecord,
  budgetMs: number,
  trace?: QueueJobTrace,
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new IncrementalSyncWallClockBudgetExceededError(job.id, budgetMs));
    }, budgetMs);
  });
  try {
    await Promise.race([runQueuedLastfmImport(pool, env, job, trace), budget]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
