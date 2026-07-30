import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  requeueStaleRunningExportJobs: vi.fn(),
  setExportJobBullmqJobId: vi.fn(),
  createExportsQueue: vi.fn(),
  enqueueExportsJob: vi.fn(),
  mockClose: vi.fn(),
}));

vi.mock("@vs/db", () => ({
  requeueStaleRunningExportJobs: hoisted.requeueStaleRunningExportJobs,
  setExportJobBullmqJobId: hoisted.setExportJobBullmqJobId,
}));

vi.mock("@vs/queue", () => ({
  createExportsQueue: hoisted.createExportsQueue,
  enqueueExportsJob: hoisted.enqueueExportsJob,
  EXPORTS_QUEUE_JOB_NAME: { USER_DATA_PACKAGE: "user_data_package" },
}));

import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";

import { runExportStaleRecoveryTick } from "./runExportStaleRecoveryTick.js";

describe("runExportStaleRecoveryTick", () => {
  const pool = {} as Pool;
  const env = {} as ServerEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockClose.mockResolvedValue(undefined);
    hoisted.createExportsQueue.mockReturnValue({ close: hoisted.mockClose });
    hoisted.enqueueExportsJob.mockResolvedValue({ id: "job-1" });
    hoisted.requeueStaleRunningExportJobs.mockResolvedValue([]);
    hoisted.setExportJobBullmqJobId.mockResolvedValue(undefined);
  });

  it("re-enqueues BullMQ exports for each stale row", async () => {
    hoisted.requeueStaleRunningExportJobs.mockResolvedValue([
      { id: "exp-1", userId: "user-1" },
      { id: "exp-2", userId: "user-2" },
    ]);
    await runExportStaleRecoveryTick(pool, env);
    expect(hoisted.createExportsQueue).toHaveBeenCalledWith(env);
    expect(hoisted.enqueueExportsJob).toHaveBeenCalledTimes(2);
    expect(hoisted.enqueueExportsJob).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        name: "user_data_package",
        data: { exportJobId: "exp-1", userId: "user-1" },
      }),
      { jobId: "exp-1" },
    );
    expect(hoisted.setExportJobBullmqJobId).toHaveBeenNthCalledWith(1, pool, {
      exportJobId: "exp-1",
      userId: "user-1",
      bullmqJobId: "job-1",
    });
    expect(hoisted.setExportJobBullmqJobId).toHaveBeenNthCalledWith(2, pool, {
      exportJobId: "exp-2",
      userId: "user-2",
      bullmqJobId: "job-1",
    });
    expect(hoisted.mockClose).toHaveBeenCalledTimes(1);
  });

  it("skips queue work when nothing was stale", async () => {
    await runExportStaleRecoveryTick(pool, env);
    expect(hoisted.createExportsQueue).not.toHaveBeenCalled();
    expect(hoisted.enqueueExportsJob).not.toHaveBeenCalled();
  });
});
