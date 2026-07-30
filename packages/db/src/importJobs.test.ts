import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  claimNextQueuedImportJob,
  claimNextQueuedImportJobWithPool,
  listQueuedSystemSyncImportJobsForEnqueue,
  countActiveImportJobsForUser,
  countImportJobsForUser,
  createImportJob,
  getImportJobByIdForUser,
  getLatestDashboardImportJobForUser,
  getLatestImportJobForUser,
  listImportJobsForUser,
  listImportJobsForUserWithTotalCount,
  markImportJobCompleted,
  markImportJobFailed,
  markImportJobFailedWhenRunning,
  markImportJobRunning,
  requeueRunningImportJobForBullMqRetry,
  requeueStaleRunningImportJobs,
  listStaleRunningImportJobs,
  updateImportJobProgress,
  withImportJobTransaction,
  type ImportJobDbExecutor,
} from "./importJobs.js";

describe("importJobs repository", () => {
  const query = vi.fn();
  const db = { query } as ImportJobDbExecutor;

  beforeEach(() => {
    query.mockReset();
  });

  it("createImportJob inserts a queued row", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "job-1" }] });
    const out = await createImportJob(db, {
      userId: "user-1",
      label: "my dump",
      lastfmUsername: "lastfm_user",
    });
    expect(out).toEqual({ id: "job-1" });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("insert into import_jobs"),
      ["user-1", "my dump", "lastfm_user", "user"],
    );
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("'queued'");
  });

  it("createImportJob can set source system_sync", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "job-2" }] });
    await createImportJob(db, {
      userId: "user-1",
      label: "sync",
      lastfmUsername: "lf",
      source: "system_sync",
    });
    expect(query.mock.calls[0]?.[1]).toEqual(["user-1", "sync", "lf", "system_sync"]);
  });

  it("getImportJobByIdForUser returns mapped row", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "j",
          user_id: "u",
          label: "l",
          lastfm_username: "lf",
          source: "user",
          stage: "queued",
          error_message: null,
          items_total: null,
          items_processed: 0,
          checkpoint_pages_completed: 0,
          checkpoint_oldest_uts: null,
          created_at: "2020-01-01",
          updated_at: "2020-01-02",
        },
      ],
    });
    const out = await getImportJobByIdForUser(db, {
      jobId: "j",
      userId: "u",
    });
    expect(out?.id).toBe("j");
    expect(out?.stage).toBe("queued");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("from import_jobs"),
      ["j", "u"],
    );
  });

  it("getImportJobByIdForUser returns null when absent", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const out = await getImportJobByIdForUser(db, {
      jobId: "j",
      userId: "u",
    });
    expect(out).toBeNull();
  });

  it("getImportJobByIdForUser applies source filter when provided", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await getImportJobByIdForUser(db, {
      jobId: "j",
      userId: "u",
      source: "user",
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("and source = $3::text"),
      ["j", "u", "user"],
    );
  });

  it("markImportJobRunning updates only queued rows", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const out = await markImportJobRunning(db, {
      jobId: "j",
      userId: "u",
    });
    expect(out).toBeNull();
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("stage = 'running'");
    expect(sql).toContain("stage = 'queued'");
  });

  it("requeueRunningImportJobForBullMqRetry moves running back to queued", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "j",
          user_id: "u",
          label: "l",
          lastfm_username: "lf",
          source: "user",
          stage: "queued",
          error_message: null,
          items_total: null,
          items_processed: 12,
          checkpoint_pages_completed: 2,
          checkpoint_oldest_uts: "100",
          created_at: "c",
          updated_at: "u2",
        },
      ],
    });
    const out = await requeueRunningImportJobForBullMqRetry(db, {
      jobId: "j",
      userId: "u",
    });
    expect(out?.stage).toBe("queued");
    expect(out?.items_processed).toBe(12);
    expect(out?.checkpoint_pages_completed).toBe(2);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("stage = 'queued'");
    expect(sql).toContain("stage = 'running'");
  });

  it("rejects rows whose stage is not in the domain contract", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "j",
          user_id: "u",
          label: "l",
          lastfm_username: "lf",
          source: "user",
          stage: "succeeded",
          error_message: null,
          items_total: null,
          items_processed: 0,
          checkpoint_pages_completed: 0,
          checkpoint_oldest_uts: null,
          created_at: "c",
          updated_at: "u",
        },
      ],
    });
    await expect(
      markImportJobRunning(db, { jobId: "j", userId: "u" }),
    ).rejects.toThrow(/invalid stage/);
  });

  it("markImportJobFailed persists error_message", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "j",
          user_id: "u",
          label: "l",
          lastfm_username: "lf",
          source: "user",
          stage: "failed",
          error_message: "boom",
          items_total: null,
          items_processed: 0,
          checkpoint_pages_completed: 0,
          checkpoint_oldest_uts: null,
          created_at: "c",
          updated_at: "u",
        },
      ],
    });
    const out = await markImportJobFailed(db, {
      jobId: "j",
      userId: "u",
      errorMessage: "boom",
    });
    expect(out?.stage).toBe("failed");
    expect(out?.error_message).toBe("boom");
    expect(query.mock.calls[0]?.[1]).toEqual(["j", "u", "boom"]);
  });

  it("markImportJobFailedWhenRunning updates only running rows", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const out = await markImportJobFailedWhenRunning(db, {
      jobId: "j",
      userId: "u",
      errorMessage: "x",
    });
    expect(out).toBeNull();
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("stage = 'running'");
  });

  it("updateImportJobProgress returns null when not running", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const out = await updateImportJobProgress(db, {
      jobId: "j",
      userId: "u",
      itemsProcessed: 10,
    });
    expect(out).toBeNull();
  });

  it("updateImportJobProgress can persist checkpoint fields", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "j",
          user_id: "u",
          label: "l",
          lastfm_username: "lf",
          source: "user",
          stage: "running",
          error_message: null,
          items_total: null,
          items_processed: 200,
          checkpoint_pages_completed: 1,
          checkpoint_oldest_uts: "1700000000",
          created_at: "c",
          updated_at: "u",
        },
      ],
    });
    const out = await updateImportJobProgress(db, {
      jobId: "j",
      userId: "u",
      itemsProcessed: 200,
      checkpointPagesCompleted: 1,
      checkpointOldestUts: 1700000000n,
    });
    expect(out?.checkpoint_pages_completed).toBe(1);
    expect(out?.checkpoint_oldest_uts).toBe(1700000000n);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("checkpoint_pages_completed");
    expect(sql).toContain("checkpoint_oldest_uts");
  });

  it("listStaleRunningImportJobs selects running rows older than cutoff", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "j1",
          user_id: "u1",
          source: "user",
          updated_at: "2026-01-01T00:00:00.000Z",
          items_processed: 12,
        },
      ],
    });
    const out = await listStaleRunningImportJobs(db, { staleAfterSeconds: 120 });
    expect(out).toEqual([
      {
        id: "j1",
        userId: "u1",
        source: "user",
        updatedAt: "2026-01-01T00:00:00.000Z",
        itemsProcessed: 12,
      },
    ]);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("stage = 'running'");
    expect(sql).toContain("updated_at < now()");
    expect(query.mock.calls[0]?.[1]).toEqual([120]);
  });

  it("requeueStaleRunningImportJobs updates stale running rows", async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: "a", user_id: "u1", source: "user" },
        { id: "b", user_id: "u2", source: "system_sync" },
      ],
    });
    const out = await requeueStaleRunningImportJobs(db, { staleAfterSeconds: 600 });
    expect(out).toEqual([
      { id: "a", userId: "u1", source: "user" },
      { id: "b", userId: "u2", source: "system_sync" },
    ]);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("stage = 'queued'");
    expect(sql).toContain("checkpoint_pages_completed = 0");
    expect(sql).toContain("Stale running import re-queued");
    expect(sql).toContain("Previous error_message");
    expect(sql).not.toContain("error_message = null");
    expect(sql).toContain("returning id, user_id, source");
    expect(query.mock.calls[0]?.[1]).toEqual([600]);
  });

  it("getLatestImportJobForUser uses deterministic newest-first ordering", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await getLatestImportJobForUser(db, "u");
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toMatch(/order by created_at desc,\s*id desc/i);
  });

  it("getLatestDashboardImportJobForUser filters to source user", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await getLatestDashboardImportJobForUser(db, "u");
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("source = 'user'");
    expect(sql).toMatch(/order by created_at desc,\s*id desc/i);
  });

  it("listImportJobsForUser caps limit and orders newest first", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listImportJobsForUser(db, { userId: "u", limit: 999 });
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toMatch(/order by created_at desc,\s*id desc/i);
    expect(sql).toContain("limit $2::int");
    expect(sql).toContain("offset $3::int");
    expect(query.mock.calls[0]?.[1]).toEqual(["u", 100, 0]);
  });

  it("listImportJobsForUser applies offset", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listImportJobsForUser(db, { userId: "u", limit: 10, offset: 20 });
    expect(query.mock.calls[0]?.[1]).toEqual(["u", 10, 20]);
  });

  it("listImportJobsForUserWithTotalCount returns rows and total from first row", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "j1",
          user_id: "u",
          label: "L",
          lastfm_username: "x",
          source: "user",
          stage: "completed",
          error_message: null,
          items_total: 1,
          items_processed: 1,
          checkpoint_pages_completed: 0,
          checkpoint_oldest_uts: null,
          created_at: "2020-01-01T00:00:00.000Z",
          updated_at: "2020-01-01T00:00:00.000Z",
          vs_total_count: 7,
        },
      ],
    });
    const out = await listImportJobsForUserWithTotalCount(db, {
      userId: "u",
      limit: 10,
      offset: 0,
    });
    expect(out.totalCount).toBe(7);
    expect(out.records).toHaveLength(1);
    expect(out.records[0]?.id).toBe("j1");
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("vs_total_count");
    expect(sql.toLowerCase()).toContain("with agg as");
    expect(sql.toLowerCase()).toContain("cross join agg");
  });

  it("listImportJobsForUserWithTotalCount falls back to count when page is empty", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ c: 3 }] });
    const out = await listImportJobsForUserWithTotalCount(db, {
      userId: "u",
      limit: 10,
      offset: 100,
    });
    expect(out.records).toHaveLength(0);
    expect(out.totalCount).toBe(3);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("countImportJobsForUser returns count", async () => {
    query.mockResolvedValueOnce({ rows: [{ c: 42 }] });
    const n = await countImportJobsForUser(db, "u");
    expect(n).toBe(42);
    expect(String(query.mock.calls[0]?.[0])).toContain("count(*)");
  });

  it("countActiveImportJobsForUser counts queued and running only", async () => {
    query.mockResolvedValueOnce({ rows: [{ c: 1 }] });
    const n = await countActiveImportJobsForUser(db, "u");
    expect(n).toBe(1);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("stage in ('queued', 'running')");
    expect(query.mock.calls[0]?.[1]).toEqual(["u"]);
  });

  it("withImportJobTransaction commits on success", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined),
    };
    const fn = vi.fn().mockResolvedValue(42);
    const result = await withImportJobTransaction(
      client as unknown as import("pg").PoolClient,
      fn,
    );
    expect(result).toBe(42);
    expect(client.query).toHaveBeenCalledWith("begin");
    expect(client.query).toHaveBeenCalledWith("commit");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("withImportJobTransaction rolls back on error", async () => {
    const client = {
      query: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      withImportJobTransaction(
        client as unknown as import("pg").PoolClient,
        async () => {
          throw new Error("x");
        },
      ),
    ).rejects.toThrow("x");
    expect(client.query).toHaveBeenCalledWith("begin");
    expect(client.query).toHaveBeenCalledWith("rollback");
  });

  it("markImportJobCompleted only from running", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await markImportJobCompleted(db, { jobId: "j", userId: "u" });
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("stage = 'completed'");
    expect(sql).toContain("stage = 'running'");
  });

  it("claimNextQueuedImportJob commits and returns a running row", async () => {
    const row = {
      id: "job-1",
      user_id: "user-1",
      label: "My import",
      lastfm_username: "lastfmuser",
      source: "system_sync",
      stage: "running",
      error_message: null,
      items_total: null,
      items_processed: 0,
      checkpoint_pages_completed: 0,
      checkpoint_oldest_uts: null,
      created_at: "c",
      updated_at: "u",
    };
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce(undefined),
    };
    const out = await claimNextQueuedImportJob(
      client as unknown as PoolClient,
    );
    expect(out?.id).toBe("job-1");
    expect(out?.stage).toBe("running");
    expect(client.query).toHaveBeenCalledWith("begin");
    expect(client.query).toHaveBeenCalledWith("commit");
    const claimSql = String(client.query.mock.calls[1]?.[0]);
    expect(claimSql).toContain("for update skip locked");
    expect(claimSql).toContain("stage = 'running'");
    expect(claimSql).toContain("source = 'system_sync'");
    expect(claimSql).toContain("checkpoint_pages_completed");
    expect(claimSql).toContain("checkpoint_oldest_uts");
    expect(claimSql).toContain("ij.source");
  });

  it("claimNextQueuedImportJob returns null when no queued rows", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(undefined),
    };
    const out = await claimNextQueuedImportJob(
      client as unknown as PoolClient,
    );
    expect(out).toBeNull();
  });

  it("claimNextQueuedImportJob rolls back on error", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("db down")),
    };
    await expect(
      claimNextQueuedImportJob(client as unknown as PoolClient),
    ).rejects.toThrow("db down");
    expect(client.query).toHaveBeenCalledWith("rollback");
  });

  it("claimNextQueuedImportJobWithPool releases client", async () => {
    const row = {
      id: "job-1",
      user_id: "user-1",
      label: "l",
      lastfm_username: "u",
      source: "system_sync",
      stage: "running",
      error_message: null,
      items_total: null,
      items_processed: 0,
      checkpoint_pages_completed: 0,
      checkpoint_oldest_uts: null,
      created_at: "c",
      updated_at: "u",
    };
    const release = vi.fn();
    const pool = {
      connect: vi.fn().mockResolvedValue({
        query: vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce({ rows: [row] })
          .mockResolvedValueOnce(undefined),
        release,
      }),
    };
    const out = await claimNextQueuedImportJobWithPool(
      pool as unknown as import("pg").Pool,
    );
    expect(out?.lastfm_username).toBe("u");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("listQueuedSystemSyncImportJobsForEnqueue maps rows and caps limit at 50", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: "j1", user_id: "u1" }],
    });
    const out = await listQueuedSystemSyncImportJobsForEnqueue(db, { limit: 999 });
    expect(out).toEqual([{ id: "j1", userId: "u1" }]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("from import_jobs"), [50]);
  });

  it("listQueuedSystemSyncImportJobsForEnqueue clamps non-positive limit to 1", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listQueuedSystemSyncImportJobsForEnqueue(db, { limit: 0 });
    expect(query).toHaveBeenCalledWith(expect.any(String), [1]);
  });
});
