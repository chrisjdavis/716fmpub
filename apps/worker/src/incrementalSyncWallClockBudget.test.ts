import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import type { ImportJobRecord } from "@vs/db";

const hoisted = vi.hoisted(() => ({
  runQueuedLastfmImport: vi.fn(),
}));

vi.mock("./runQueuedLastfmImport.js", () => ({
  runQueuedLastfmImport: hoisted.runQueuedLastfmImport,
}));

import {
  IncrementalSyncWallClockBudgetExceededError,
  runQueuedLastfmImportWithinWallClockBudget,
} from "./incrementalSyncWallClockBudget.js";

const pool = {} as Pool;
const env = {} as ServerEnv;

const job = {
  id: "22222222-2222-4222-8222-222222222222",
  user_id: "11111111-1111-4111-8111-111111111111",
  label: "x",
  lastfm_username: "lf",
  source: "system_sync" as const,
  stage: "running" as const,
  error_message: null,
  items_total: null,
  items_processed: 0,
  checkpoint_pages_completed: 0,
  checkpoint_oldest_uts: null,
  created_at: "c",
  updated_at: "u",
} satisfies ImportJobRecord;

describe("runQueuedLastfmImportWithinWallClockBudget", () => {
  let releaseImport: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    releaseImport = undefined;
  });

  afterEach(() => {
    releaseImport?.();
    vi.useRealTimers();
  });

  it("rejects with IncrementalSyncWallClockBudgetExceededError when the pipeline never settles", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    hoisted.runQueuedLastfmImport.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseImport = resolve;
        }),
    );

    const p = runQueuedLastfmImportWithinWallClockBudget(pool, env, job, 5_000);
    await expect(
      Promise.all([p, vi.advanceTimersByTimeAsync(5_001)]),
    ).rejects.toMatchObject({
      code: "INCREMENTAL_SYNC_WALL_CLOCK_BUDGET_EXCEEDED",
      importJobId: job.id,
      budgetMs: 5_000,
    });
  });

  it("resolves when the pipeline finishes before the budget", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    hoisted.runQueuedLastfmImport.mockResolvedValue(undefined);

    const p = runQueuedLastfmImportWithinWallClockBudget(pool, env, job, 60_000);
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toBeUndefined();
    expect(hoisted.runQueuedLastfmImport).toHaveBeenCalledOnce();
  });
});
