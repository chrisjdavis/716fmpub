import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportJobRecord } from "@vs/db";
import type { Pool } from "pg";

const dbMocks = vi.hoisted(() => ({
  getUserProfileFields: vi.fn(),
  getLatestDashboardImportJobForUser: vi.fn(),
  getListenSyncSummaryForUser: vi.fn(),
  listImportJobsForUserWithTotalCount: vi.fn(),
  listImportJobsForUser: vi.fn(),
}));

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getUserProfileFields: dbMocks.getUserProfileFields,
    getLatestDashboardImportJobForUser: dbMocks.getLatestDashboardImportJobForUser,
    getListenSyncSummaryForUser: dbMocks.getListenSyncSummaryForUser,
    listImportJobsForUserWithTotalCount: dbMocks.listImportJobsForUserWithTotalCount,
    listImportJobsForUser: dbMocks.listImportJobsForUser,
  };
});

import { loadImportsPageData } from "./imports-page-data";

const fakePool = {} as Pool;
const userId = "00000000-0000-4000-8000-000000000002";

function jobRow(overrides: Partial<ImportJobRecord> = {}): ImportJobRecord {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    user_id: userId,
    label: "L",
    lastfm_username: "u",
    source: "user",
    stage: "completed",
    error_message: null,
    items_total: 1,
    items_processed: 1,
    checkpoint_pages_completed: 0,
    checkpoint_oldest_uts: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("loadImportsPageData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getUserProfileFields.mockResolvedValue({ lastfm_username: "lastfm" });
    dbMocks.getListenSyncSummaryForUser.mockResolvedValue(null);
    dbMocks.listImportJobsForUser.mockResolvedValue([]);
  });

  it("page 1 uses a single listImportJobsForUserWithTotalCount call and skips listImportJobsForUser", async () => {
    const latest = jobRow({ stage: "completed" });
    dbMocks.getLatestDashboardImportJobForUser.mockResolvedValue(latest);
    dbMocks.listImportJobsForUserWithTotalCount.mockResolvedValue({
      records: [latest],
      totalCount: 1,
    });

    await loadImportsPageData(fakePool, userId, {
      listenSyncMinIntervalSeconds: 60,
      importHistoryPage: 1,
    });

    expect(dbMocks.listImportJobsForUserWithTotalCount).toHaveBeenCalledTimes(1);
    expect(dbMocks.listImportJobsForUserWithTotalCount).toHaveBeenCalledWith(
      fakePool,
      expect.objectContaining({
        userId,
        limit: 10,
        offset: 0,
      }),
    );
    expect(dbMocks.listImportJobsForUser).not.toHaveBeenCalled();
  });

  it("refetches with listImportJobsForUser when requested page clamps to a different offset", async () => {
    const latest = jobRow({ stage: "completed" });
    dbMocks.getLatestDashboardImportJobForUser.mockResolvedValue(latest);
    dbMocks.listImportJobsForUserWithTotalCount.mockResolvedValueOnce({
      records: [],
      totalCount: 5,
    });
    dbMocks.listImportJobsForUser.mockResolvedValueOnce([latest]);

    const model = await loadImportsPageData(fakePool, userId, {
      listenSyncMinIntervalSeconds: 60,
      importHistoryPage: 99,
    });

    expect(dbMocks.listImportJobsForUserWithTotalCount).toHaveBeenCalledTimes(1);
    expect(dbMocks.listImportJobsForUser).toHaveBeenCalledTimes(1);
    expect(dbMocks.listImportJobsForUser).toHaveBeenCalledWith(fakePool, {
      userId,
      limit: 10,
      offset: 0,
    });
    expect(model.jobHistoryPaging.page).toBe(1);
    expect(model.jobHistoryPaging.totalCount).toBe(5);
  });
});
