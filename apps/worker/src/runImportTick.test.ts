import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  requeueStaleRunningImportJobs: vi.fn(),
  listQueuedSystemSyncImportJobsForEnqueue: vi.fn(),
  createImportsQueue: vi.fn(),
  enqueueImportsJob: vi.fn(),
  enqueueIncrementalSyncJobsForImportRows: vi.fn(),
  mockClose: vi.fn(),
}));

vi.mock("@vs/db", () => ({
  requeueStaleRunningImportJobs: hoisted.requeueStaleRunningImportJobs,
  listQueuedSystemSyncImportJobsForEnqueue: hoisted.listQueuedSystemSyncImportJobsForEnqueue,
}));

vi.mock("./enqueueIncrementalSyncJobs.js", () => ({
  enqueueIncrementalSyncJobsForImportRows: hoisted.enqueueIncrementalSyncJobsForImportRows,
}));

vi.mock("@vs/queue", () => ({
  createImportsQueue: hoisted.createImportsQueue,
  enqueueImportsJob: hoisted.enqueueImportsJob,
  IMPORTS_QUEUE_JOB_NAME: { LASTFM_ROWS_IMPORT: "lastfm_rows_import" },
}));

import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";

import { runImportTick } from "./runImportTick.js";

describe("runImportTick", () => {
  const pool = {} as Pool;
  const env = {} as ServerEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockClose.mockResolvedValue(undefined);
    hoisted.createImportsQueue.mockReturnValue({ close: hoisted.mockClose });
    hoisted.enqueueImportsJob.mockResolvedValue({ id: "q1" });
    hoisted.requeueStaleRunningImportJobs.mockResolvedValue([]);
    hoisted.listQueuedSystemSyncImportJobsForEnqueue.mockResolvedValue([]);
    hoisted.enqueueIncrementalSyncJobsForImportRows.mockResolvedValue(undefined);
  });

  it("re-enqueues BullMQ imports for stale user-sourced requeues", async () => {
    hoisted.requeueStaleRunningImportJobs.mockResolvedValue([
      { id: "imp-1", userId: "user-1", source: "user" },
    ]);
    await runImportTick(pool, env);
    expect(hoisted.enqueueImportsJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "lastfm_rows_import",
        data: { importJobId: "imp-1", userId: "user-1" },
      }),
    );
    expect(hoisted.mockClose).toHaveBeenCalledTimes(1);
  });

  it("re-enqueues incremental_sync for stale system_sync requeues", async () => {
    hoisted.requeueStaleRunningImportJobs.mockResolvedValue([
      { id: "imp-2", userId: "user-1", source: "system_sync" },
    ]);
    await runImportTick(pool, env);
    expect(hoisted.enqueueImportsJob).not.toHaveBeenCalled();
    expect(hoisted.createImportsQueue).not.toHaveBeenCalled();
    expect(hoisted.enqueueIncrementalSyncJobsForImportRows).toHaveBeenCalledWith(env, [
      { id: "imp-2", userId: "user-1" },
    ]);
  });

  it("publishes incremental_sync for queued system_sync rows returned by the DB helper", async () => {
    hoisted.listQueuedSystemSyncImportJobsForEnqueue.mockResolvedValue([
      { id: "q-1", userId: "user-9" },
    ]);
    await runImportTick(pool, env);
    expect(hoisted.listQueuedSystemSyncImportJobsForEnqueue).toHaveBeenCalledWith(pool, {
      limit: 20,
    });
    expect(hoisted.enqueueIncrementalSyncJobsForImportRows).toHaveBeenCalledWith(env, [
      { id: "q-1", userId: "user-9" },
    ]);
  });

  it("merges stale system_sync republish with listQueued into one incremental_sync enqueue", async () => {
    hoisted.requeueStaleRunningImportJobs.mockResolvedValue([
      { id: "imp-2", userId: "user-1", source: "system_sync" },
    ]);
    hoisted.listQueuedSystemSyncImportJobsForEnqueue.mockResolvedValue([
      { id: "imp-2", userId: "user-1" },
      { id: "q-1", userId: "user-9" },
    ]);
    await runImportTick(pool, env);
    expect(hoisted.enqueueIncrementalSyncJobsForImportRows).toHaveBeenCalledTimes(1);
    expect(hoisted.enqueueIncrementalSyncJobsForImportRows).toHaveBeenCalledWith(env, [
      { id: "imp-2", userId: "user-1" },
      { id: "q-1", userId: "user-9" },
    ]);
  });
});
