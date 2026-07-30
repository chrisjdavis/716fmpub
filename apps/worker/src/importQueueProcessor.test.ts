import { UnrecoverableError, type Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import { IMPORTS_QUEUE_JOB_NAME } from "@vs/queue";

import { processImportsJob } from "./importQueueProcessor.js";

const USER = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";

const hoisted = vi.hoisted(() => ({
  markImportJobRunning: vi.fn(),
  getImportJobByIdForUser: vi.fn(),
  requeueRunningImportJobForBullMqRetry: vi.fn(),
  runQueuedLastfmImport: vi.fn(),
}));

vi.mock("@vs/db", () => ({
  markImportJobRunning: hoisted.markImportJobRunning,
  getImportJobByIdForUser: hoisted.getImportJobByIdForUser,
  requeueRunningImportJobForBullMqRetry: hoisted.requeueRunningImportJobForBullMqRetry,
}));

vi.mock("./runQueuedLastfmImport.js", () => ({
  runQueuedLastfmImport: hoisted.runQueuedLastfmImport,
}));

function bullMqJob(): Job {
  return {
    id: "bmq-1",
    name: IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT,
    data: { importJobId: JOB, userId: USER },
  } as unknown as Job;
}

const pool = {} as Pool;
const env = {} as ServerEnv;

const preflightUserJobRow = {
  id: JOB,
  user_id: USER,
  label: "x",
  lastfm_username: "lf",
  source: "user" as const,
  stage: "queued" as const,
  error_message: null,
  items_total: null,
  items_processed: 0,
  checkpoint_pages_completed: 0,
  checkpoint_oldest_uts: null,
  created_at: "c",
  updated_at: "u",
};

describe("processImportsJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses the BullMQ job when no user-scoped import row matches payload (cross-account or wrong queue)", async () => {
    hoisted.getImportJobByIdForUser.mockResolvedValueOnce(null);
    await expect(processImportsJob(bullMqJob(), pool, env)).rejects.toThrow(
      /no user-scoped import job/,
    );
    expect(hoisted.markImportJobRunning).not.toHaveBeenCalled();
    expect(hoisted.getImportJobByIdForUser).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        jobId: JOB,
        userId: USER,
        source: "user",
      }),
    );
  });

  it("re-queues running import then rethrows on unexpected pipeline errors", async () => {
    const claimed = {
      id: JOB,
      user_id: USER,
      label: "x",
      lastfm_username: "lf",
      source: "user" as const,
      stage: "running" as const,
      error_message: null,
      items_total: null,
      items_processed: 0,
      checkpoint_pages_completed: 0,
      checkpoint_oldest_uts: null,
      created_at: "c",
      updated_at: "u",
    };
    hoisted.getImportJobByIdForUser
      .mockResolvedValueOnce(preflightUserJobRow)
      .mockResolvedValueOnce({
        ...claimed,
        stage: "running",
      });
    hoisted.markImportJobRunning.mockResolvedValueOnce(claimed);
    const boom = new Error("simulated worker fault");
    hoisted.runQueuedLastfmImport.mockRejectedValueOnce(boom);
    hoisted.requeueRunningImportJobForBullMqRetry.mockResolvedValueOnce({
      ...claimed,
      stage: "queued",
    });

    await expect(processImportsJob(bullMqJob(), pool, env)).rejects.toBe(boom);
    expect(hoisted.requeueRunningImportJobForBullMqRetry).toHaveBeenCalledWith(
      pool,
      { jobId: JOB, userId: USER },
    );
  });

  it("does not re-queue when the pipeline throws UnrecoverableError", async () => {
    const claimed = {
      id: JOB,
      user_id: USER,
      label: "x",
      lastfm_username: "lf",
      source: "user" as const,
      stage: "running" as const,
      error_message: null,
      items_total: null,
      items_processed: 0,
      checkpoint_pages_completed: 0,
      checkpoint_oldest_uts: null,
      created_at: "c",
      updated_at: "u",
    };
    hoisted.getImportJobByIdForUser.mockResolvedValueOnce(preflightUserJobRow);
    hoisted.markImportJobRunning.mockResolvedValueOnce(claimed);
    const fatal = new UnrecoverableError("no retry");
    hoisted.runQueuedLastfmImport.mockRejectedValueOnce(fatal);

    await expect(processImportsJob(bullMqJob(), pool, env)).rejects.toBe(fatal);
    expect(hoisted.requeueRunningImportJobForBullMqRetry).not.toHaveBeenCalled();
  });

  it("acks BullMQ when the row is already terminal after a throw", async () => {
    const claimed = {
      id: JOB,
      user_id: USER,
      label: "x",
      lastfm_username: "lf",
      source: "user" as const,
      stage: "running" as const,
      error_message: null,
      items_total: null,
      items_processed: 0,
      checkpoint_pages_completed: 0,
      checkpoint_oldest_uts: null,
      created_at: "c",
      updated_at: "u",
    };
    hoisted.getImportJobByIdForUser
      .mockResolvedValueOnce(preflightUserJobRow)
      .mockResolvedValueOnce({
        ...claimed,
        stage: "failed",
        error_message: "already recorded",
      });
    hoisted.markImportJobRunning.mockResolvedValueOnce(claimed);
    hoisted.runQueuedLastfmImport.mockRejectedValueOnce(new Error("late fault"));

    await expect(processImportsJob(bullMqJob(), pool, env)).resolves.toBeUndefined();
    expect(hoisted.requeueRunningImportJobForBullMqRetry).not.toHaveBeenCalled();
  });
});
