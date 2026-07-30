import { UnrecoverableError, type Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vs/db", () => ({
  getExportJobByIdForUser: vi.fn(),
  markExportJobCompleted: vi.fn(),
  markExportJobFailed: vi.fn(),
  tryMarkExportJobRunning: vi.fn(),
}));

vi.mock("./listenExportZipGeneration.js", () => ({
  generateListenExportZipFile: vi.fn(),
}));

import {
  getExportJobByIdForUser,
  markExportJobCompleted,
  markExportJobFailed,
  tryMarkExportJobRunning,
} from "@vs/db";
import { generateListenExportZipFile } from "./listenExportZipGeneration.js";
import { processExportsJob } from "./exportQueueProcessor.js";

const USER = "11111111-1111-4111-8111-111111111111";
const EXPORT = "22222222-2222-4222-8222-222222222222";

function jobStub(): Job {
  return {
    id: "jq-1",
    name: "user_data_package",
    data: { userId: USER, exportJobId: EXPORT },
  } as unknown as Job;
}

describe("processExportsJob", () => {
  const pool = {} as never;
  const env = {
    EXPORT_ARTIFACTS_DIR: "/tmp/exports",
    EXPORT_ARTIFACT_RETENTION_SEC: 604800,
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no-ops when the export row is already expired", async () => {
    vi.mocked(getExportJobByIdForUser).mockResolvedValue({
      id: EXPORT,
      userId: USER,
      format: "json",
      stage: "expired",
      artifactRelativePath: null,
      artifactExpiresAt: "2026-01-01T00:00:00.000Z",
      artifactDeliveryToken: null,
      errorMessage: "Export expired.",
      bullmqJobId: EXPORT,
      itemsProcessed: 0,
      itemsTotal: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    await processExportsJob(jobStub(), pool, env);
    expect(tryMarkExportJobRunning).not.toHaveBeenCalled();
    expect(generateListenExportZipFile).not.toHaveBeenCalled();
  });

  it("no-ops when the export row is already completed", async () => {
    vi.mocked(getExportJobByIdForUser).mockResolvedValue({
      id: EXPORT,
      userId: USER,
      format: "json",
      stage: "completed",
      artifactRelativePath: `${USER}/${EXPORT}.zip`,
      artifactExpiresAt: "2099-01-01T00:00:00.000Z",
      artifactDeliveryToken: "p".repeat(43),
      errorMessage: null,
      bullmqJobId: EXPORT,
      itemsProcessed: 5,
      itemsTotal: 5,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    await processExportsJob(jobStub(), pool, env);
    expect(tryMarkExportJobRunning).not.toHaveBeenCalled();
    expect(generateListenExportZipFile).not.toHaveBeenCalled();
  });

  it("claims queued work, generates the ZIP, and marks completed", async () => {
    vi.mocked(getExportJobByIdForUser).mockResolvedValueOnce({
      id: EXPORT,
      userId: USER,
      format: "json",
      stage: "queued",
      artifactRelativePath: null,
      artifactExpiresAt: null,
      artifactDeliveryToken: null,
      errorMessage: null,
      bullmqJobId: EXPORT,
      itemsProcessed: 0,
      itemsTotal: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    vi.mocked(tryMarkExportJobRunning).mockResolvedValue({
      id: EXPORT,
      userId: USER,
      format: "json",
      stage: "running",
      artifactRelativePath: null,
      artifactExpiresAt: null,
      artifactDeliveryToken: null,
      errorMessage: null,
      bullmqJobId: EXPORT,
      itemsProcessed: 0,
      itemsTotal: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    vi.mocked(generateListenExportZipFile).mockResolvedValue({
      artifactRelativePath: `${USER}/${EXPORT}.zip`,
      displayZipName: "716fm-listens-2026-01-01-json.zip",
      itemsProcessed: 3,
    });
    vi.mocked(markExportJobCompleted).mockResolvedValue("updated");

    await processExportsJob(jobStub(), pool, env);

    expect(generateListenExportZipFile).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        exportJobId: EXPORT,
        format: "json",
        artifactsBaseDir: "/tmp/exports",
        exportJobProgress: { exportJobId: EXPORT, userId: USER },
      }),
    );
    expect(markExportJobCompleted).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        exportJobId: EXPORT,
        userId: USER,
        artifactRelativePath: `${USER}/${EXPORT}.zip`,
        artifactRetentionSeconds: 604800,
        finalItemsProcessed: 3,
        artifactDeliveryToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
  });

  it("marks failed and rethrows when generation throws", async () => {
    vi.mocked(getExportJobByIdForUser).mockResolvedValue({
      id: EXPORT,
      userId: USER,
      format: "csv",
      stage: "running",
      artifactRelativePath: null,
      artifactExpiresAt: null,
      artifactDeliveryToken: null,
      errorMessage: null,
      bullmqJobId: EXPORT,
      itemsProcessed: 0,
      itemsTotal: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    vi.mocked(generateListenExportZipFile).mockRejectedValue(new Error("disk full"));

    await expect(processExportsJob(jobStub(), pool, env)).rejects.toThrow(/disk full/);
    expect(markExportJobFailed).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        exportJobId: EXPORT,
        userId: USER,
        errorMessage: "disk full",
      }),
    );
  });

  it("marks failed when ZIP generation succeeded but completion update throws", async () => {
    vi.mocked(getExportJobByIdForUser).mockResolvedValue({
      id: EXPORT,
      userId: USER,
      format: "json",
      stage: "running",
      artifactRelativePath: null,
      artifactExpiresAt: null,
      artifactDeliveryToken: null,
      errorMessage: null,
      bullmqJobId: EXPORT,
      itemsProcessed: 0,
      itemsTotal: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    vi.mocked(generateListenExportZipFile).mockResolvedValue({
      artifactRelativePath: `${USER}/${EXPORT}.zip`,
      displayZipName: "716fm-listens-2026-01-01-json.zip",
      itemsProcessed: 0,
    });
    vi.mocked(markExportJobCompleted).mockRejectedValue(new Error("postgres unavailable"));

    await expect(processExportsJob(jobStub(), pool, env)).rejects.toThrow(/postgres unavailable/);
    expect(markExportJobFailed).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        exportJobId: EXPORT,
        userId: USER,
        errorMessage: expect.stringMatching(/postgres unavailable.*completion update failed/),
      }),
    );
  });

  it("throws UnrecoverableError when the row is already failed", async () => {
    vi.mocked(getExportJobByIdForUser).mockResolvedValue({
      id: EXPORT,
      userId: USER,
      format: "json",
      stage: "failed",
      artifactRelativePath: null,
      artifactExpiresAt: null,
      artifactDeliveryToken: null,
      errorMessage: "prior",
      bullmqJobId: EXPORT,
      itemsProcessed: 0,
      itemsTotal: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await expect(processExportsJob(jobStub(), pool, env)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});
