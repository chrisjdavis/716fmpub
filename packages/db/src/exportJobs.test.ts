import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimExpiredListenExportArtifacts,
  computeListenExportArtifactAccess,
  countActiveExportJobsForUser,
  createExportJob,
  getExportJobByIdForUser,
  LISTEN_EXPORT_EXPIRED_ERROR_MESSAGE,
  markExportJobCompleted,
  markExportJobFailed,
  listStaleRunningExportJobs,
  markExportJobFailedWhenQueued,
  requeueStaleRunningExportJobs,
  resetExportJobListenProgress,
  setExportJobBullmqJobId,
  tryMarkExportJobRunning,
  updateExportJobListenProgress,
  type ExportJobRecord,
  type ExportJobDbExecutor,
} from "./exportJobs.js";

function baseRow(
  overrides: Partial<{
    id: string;
    user_id: string;
    format: string;
    stage: string;
    artifact_relative_path: string | null;
    artifact_expires_at: string | null;
    error_message: string | null;
    bullmq_job_id: string | null;
    items_processed: number;
    items_total: number | null;
    created_at: string;
    updated_at: string;
    artifact_delivery_token?: string | null;
  }> = {},
) {
  return {
    id: "e1",
    user_id: "u1",
    format: "json",
    stage: "queued",
    artifact_relative_path: null,
    artifact_expires_at: null,
    artifact_delivery_token: null,
    error_message: null,
    bullmq_job_id: null,
    items_processed: 0,
    items_total: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("exportJobs repository", () => {
  const query = vi.fn();
  const db = { query } as ExportJobDbExecutor;

  beforeEach(() => {
    query.mockReset();
  });

  it("createExportJob inserts queued row", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "e1" }] });
    const out = await createExportJob(db, { userId: "u1", format: "json" });
    expect(out).toEqual({ id: "e1" });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("insert into export_jobs"),
      ["u1", "json"],
    );
  });

  it("listStaleRunningExportJobs selects running exports older than cutoff", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "e1",
          user_id: "u1",
          format: "json",
          updated_at: "2026-01-01T00:00:00.000Z",
          items_processed: 3,
          bullmq_job_id: "e1",
        },
      ],
    });
    const out = await listStaleRunningExportJobs(db, { staleAfterSeconds: 300 });
    expect(out).toEqual([
      {
        id: "e1",
        userId: "u1",
        format: "json",
        updatedAt: "2026-01-01T00:00:00.000Z",
        itemsProcessed: 3,
        bullmqJobId: "e1",
      },
    ]);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("stage = 'running'");
    expect(sql).toContain("updated_at < now()");
    expect(query.mock.calls[0]?.[1]).toEqual([300]);
  });

  it("requeueStaleRunningExportJobs moves stale running exports to queued", async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: "e1", user_id: "u1" },
        { id: "e2", user_id: "u2" },
      ],
    });
    const out = await requeueStaleRunningExportJobs(db, { staleAfterSeconds: 600 });
    expect(out).toEqual([
      { id: "e1", userId: "u1" },
      { id: "e2", userId: "u2" },
    ]);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("stage = 'queued'");
    expect(sql).toContain("bullmq_job_id = null");
    expect(sql).toContain("Stale running export re-queued");
    expect(sql).toContain("Previous error_message");
    expect(query.mock.calls[0]?.[1]).toEqual([600]);
  });

  it("countActiveExportJobsForUser returns count from SQL", async () => {
    query.mockResolvedValueOnce({ rows: [{ c: 2 }] });
    const n = await countActiveExportJobsForUser(db, "u1");
    expect(n).toBe(2);
    expect(String(query.mock.calls[0]?.[0])).toContain("stage in ('queued', 'running')");
    expect(query.mock.calls[0]?.[1]).toEqual(["u1"]);
  });

  it("getExportJobByIdForUser maps row", async () => {
    query.mockResolvedValueOnce({ rows: [baseRow({ format: "csv" })] });
    const out = await getExportJobByIdForUser(db, { exportJobId: "e1", userId: "u1" });
    expect(out?.format).toBe("csv");
    expect(out?.stage).toBe("queued");
    expect(out?.artifactRelativePath).toBeNull();
    expect(out?.artifactExpiresAt).toBeNull();
  });

  it("tryMarkExportJobRunning returns mapped row when update hits", async () => {
    query.mockResolvedValueOnce({
      rows: [baseRow({ stage: "running" })],
    });
    const out = await tryMarkExportJobRunning(db, { exportJobId: "e1", userId: "u1" });
    expect(out?.stage).toBe("running");
    expect(String(query.mock.calls[0]?.[0])).toContain("stage = 'running'");
  });

  it("markExportJobCompleted returns updated when one row is touched", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const token = "t".repeat(43);
    const out = await markExportJobCompleted(db, {
      exportJobId: "e1",
      userId: "u1",
      artifactRelativePath: "u1/e1.zip",
      artifactRetentionSeconds: 3600,
      finalItemsProcessed: 42,
      artifactDeliveryToken: token,
    });
    expect(out).toBe("updated");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("stage = 'completed'"), [
      "e1",
      "u1",
      "u1/e1.zip",
      3600,
      42,
      token,
    ]);
  });

  it("markExportJobCompleted returns already_completed when row is already terminal", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    query.mockResolvedValueOnce({
      rows: [
        baseRow({
          stage: "completed",
          artifact_relative_path: "u1/e1.zip",
          artifact_expires_at: "2026-12-31T00:00:00.000Z",
          artifact_delivery_token: "x".repeat(43),
        }),
      ],
    });
    const out = await markExportJobCompleted(db, {
      exportJobId: "e1",
      userId: "u1",
      artifactRelativePath: "u1/e1.zip",
      artifactRetentionSeconds: 3600,
      finalItemsProcessed: 0,
      artifactDeliveryToken: "y".repeat(43),
    });
    expect(out).toBe("already_completed");
  });

  it("markExportJobCompleted throws when no row updated and stage is not completed", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    query.mockResolvedValueOnce({
      rows: [baseRow({ stage: "running" })],
    });
    await expect(
      markExportJobCompleted(db, {
        exportJobId: "e1",
        userId: "u1",
        artifactRelativePath: "u1/e1.zip",
        artifactRetentionSeconds: 3600,
        finalItemsProcessed: 1,
        artifactDeliveryToken: "z".repeat(43),
      }),
    ).rejects.toThrow(/markExportJobCompleted/);
  });

  it("updateExportJobListenProgress updates running row", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await updateExportJobListenProgress(db, {
      exportJobId: "e1",
      userId: "u1",
      itemsProcessed: 2000,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("items_processed = $3::int"), [
      "e1",
      "u1",
      2000,
    ]);
  });

  it("resetExportJobListenProgress clears counters for running row", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await resetExportJobListenProgress(db, { exportJobId: "e1", userId: "u1" });
    expect(String(query.mock.calls[0]?.[0])).toContain("items_processed = 0");
    expect(String(query.mock.calls[0]?.[0])).toContain("items_total = null");
  });

  it("markExportJobFailed updates one queued or running row", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await markExportJobFailed(db, {
      exportJobId: "e1",
      userId: "u1",
      errorMessage: "boom",
    });
    expect(String(query.mock.calls[0]?.[0])).toContain("stage in ('queued', 'running')");
  });

  it("markExportJobFailed is a no-op when the row is already failed", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    query.mockResolvedValueOnce({
      rows: [baseRow({ stage: "failed", error_message: "prior" })],
    });
    await markExportJobFailed(db, {
      exportJobId: "e1",
      userId: "u1",
      errorMessage: "boom",
    });
    expect(String(query.mock.calls[0]?.[0])).toContain("stage in ('queued', 'running')");
  });

  it("markExportJobFailed throws when no row updated and not already failed", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    query.mockResolvedValueOnce({
      rows: [
        baseRow({
          stage: "completed",
          artifact_relative_path: "x.zip",
          artifact_expires_at: "2026-06-01T00:00:00.000Z",
          artifact_delivery_token: "c".repeat(43),
        }),
      ],
    });
    await expect(
      markExportJobFailed(db, {
        exportJobId: "e1",
        userId: "u1",
        errorMessage: "boom",
      }),
    ).rejects.toThrow(/markExportJobFailed/);
  });

  it("markExportJobFailedWhenQueued updates exactly one queued row", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await markExportJobFailedWhenQueued(db, {
      exportJobId: "e1",
      userId: "u1",
      errorMessage: "enqueue failed",
    });
    expect(String(query.mock.calls[0]?.[0])).toContain("stage = 'queued'");
  });

  it("markExportJobFailedWhenQueued is a no-op when already failed", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    query.mockResolvedValueOnce({
      rows: [baseRow({ stage: "failed", error_message: "prior" })],
    });
    await markExportJobFailedWhenQueued(db, {
      exportJobId: "e1",
      userId: "u1",
      errorMessage: "enqueue failed",
    });
  });

  it("markExportJobFailedWhenQueued throws when row is not queued or failed", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    query.mockResolvedValueOnce({
      rows: [baseRow({ stage: "running" })],
    });
    await expect(
      markExportJobFailedWhenQueued(db, {
        exportJobId: "e1",
        userId: "u1",
        errorMessage: "enqueue failed",
      }),
    ).rejects.toThrow(/markExportJobFailedWhenQueued/);
  });

  it("setExportJobBullmqJobId updates row", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await setExportJobBullmqJobId(db, {
      exportJobId: "e1",
      userId: "u1",
      bullmqJobId: "job-42",
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("bullmq_job_id"), [
      "e1",
      "u1",
      "job-42",
    ]);
  });

  it("claimExpiredListenExportArtifacts maps returning rows", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "e1",
          user_id: "u1",
          deleted_artifact_relative_path: "u1/e1.zip",
        },
      ],
    });
    const out = await claimExpiredListenExportArtifacts(db, { limit: 10 });
    expect(out).toEqual([
      {
        exportJobId: "e1",
        userId: "u1",
        deletedArtifactRelativePath: "u1/e1.zip",
      },
    ]);
    expect(query.mock.calls[0]?.[1]).toEqual([10, LISTEN_EXPORT_EXPIRED_ERROR_MESSAGE]);
    expect(String(query.mock.calls[0]?.[0])).toContain("artifact_delivery_token = null");
  });
});

describe("computeListenExportArtifactAccess", () => {
  function completedAvailable(expires: string): ExportJobRecord {
    return {
      id: "e1",
      userId: "u1",
      format: "json",
      stage: "completed",
      artifactRelativePath: "u1/e1.zip",
      artifactExpiresAt: expires,
      artifactDeliveryToken: "d".repeat(43),
      errorMessage: null,
      bullmqJobId: null,
      itemsProcessed: 10,
      itemsTotal: 10,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  it("returns expired for terminal expired stage", () => {
    const row: ExportJobRecord = {
      ...completedAvailable("2099-01-01T00:00:00.000Z"),
      stage: "expired",
      artifactRelativePath: null,
      artifactExpiresAt: "2026-01-01T00:00:00.000Z",
      artifactDeliveryToken: null,
      itemsProcessed: 0,
      itemsTotal: null,
    };
    expect(computeListenExportArtifactAccess(row, Date.parse("2026-06-01T00:00:00.000Z"))).toBe(
      "expired",
    );
  });

  it("returns available when expiry is in the future", () => {
    const now = Date.parse("2026-01-01T12:00:00.000Z");
    expect(
      computeListenExportArtifactAccess(
        completedAvailable("2026-01-02T00:00:00.000Z"),
        now,
      ),
    ).toBe("available");
  });

  it("returns expired when expiry is in the past (soft-expired completed row)", () => {
    const now = Date.parse("2026-01-03T00:00:00.000Z");
    expect(
      computeListenExportArtifactAccess(
        completedAvailable("2026-01-02T00:00:00.000Z"),
        now,
      ),
    ).toBe("expired");
  });

  it("returns none when running", () => {
    const row: ExportJobRecord = {
      ...completedAvailable("2099-01-01T00:00:00.000Z"),
      stage: "running",
      artifactRelativePath: null,
      artifactExpiresAt: null,
      artifactDeliveryToken: null,
      itemsProcessed: 0,
      itemsTotal: null,
    };
    expect(computeListenExportArtifactAccess(row)).toBe("none");
  });

  it("returns none when completed but delivery token is missing", () => {
    const row: ExportJobRecord = {
      ...completedAvailable("2099-01-01T00:00:00.000Z"),
      artifactDeliveryToken: null,
    };
    expect(computeListenExportArtifactAccess(row, Date.parse("2026-01-01T12:00:00.000Z"))).toBe(
      "none",
    );
  });
});
