import { UnrecoverableError, type Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import { INCREMENTAL_SYNC_QUEUE_JOB_NAME } from "@vs/queue";

import { processIncrementalSyncJob } from "./incrementalSyncQueueProcessor.js";

const USER = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";

const hoisted = vi.hoisted(() => ({
  getImportJobByIdForUser: vi.fn(),
  markImportJobRunning: vi.fn(),
  requeueRunningImportJobForBullMqRetry: vi.fn(),
  runQueuedLastfmImport: vi.fn(),
}));

vi.mock("@vs/db", () => ({
  getImportJobByIdForUser: hoisted.getImportJobByIdForUser,
  markImportJobRunning: hoisted.markImportJobRunning,
  requeueRunningImportJobForBullMqRetry: hoisted.requeueRunningImportJobForBullMqRetry,
}));

vi.mock("./runQueuedLastfmImport.js", () => ({
  runQueuedLastfmImport: hoisted.runQueuedLastfmImport,
}));

function bullMqJob(): Job {
  return {
    id: "bmq-inc-1",
    name: INCREMENTAL_SYNC_QUEUE_JOB_NAME.SYSTEM_SYNC_RUN,
    data: { importJobId: JOB, userId: USER },
  } as unknown as Job;
}

const pool = {} as Pool;
const env = {} as ServerEnv;

describe("processIncrementalSyncJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects user-sourced import rows", async () => {
    hoisted.getImportJobByIdForUser.mockResolvedValueOnce({
      id: JOB,
      user_id: USER,
      label: "x",
      lastfm_username: "lf",
      source: "user",
      stage: "queued",
      error_message: null,
      items_total: null,
      items_processed: 0,
      checkpoint_pages_completed: 0,
      checkpoint_oldest_uts: null,
      created_at: "c",
      updated_at: "u",
    });
    await expect(processIncrementalSyncJob(bullMqJob(), pool, env)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(hoisted.markImportJobRunning).not.toHaveBeenCalled();
  });
});
