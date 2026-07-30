import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportJobApiRow } from "@/server/api/import-job-row";

const hoistedDb = vi.hoisted(() => ({
  getUserProfileFields: vi.fn(),
  tryReadFreshHomeBriefingSnapshot: vi.fn(),
  upsertHomeBriefingSnapshot: vi.fn(),
  getDashboardListenSummary: vi.fn(),
  getDashboardHeroWindowMetrics: vi.fn(),
  queryBriefingReturnAfterGapInsight: vi.fn(),
}));

const hoistedBundle = vi.hoisted(() => ({
  readFreshDashboardAnalyticsBundleForRequest: vi.fn(),
}));

const hoistedPageData = vi.hoisted(() => ({
  loadDashboardCompletedStats: vi.fn(),
}));

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getUserProfileFields: hoistedDb.getUserProfileFields,
    tryReadFreshHomeBriefingSnapshot: hoistedDb.tryReadFreshHomeBriefingSnapshot,
    upsertHomeBriefingSnapshot: hoistedDb.upsertHomeBriefingSnapshot,
    getDashboardListenSummary: hoistedDb.getDashboardListenSummary,
    getDashboardHeroWindowMetrics: hoistedDb.getDashboardHeroWindowMetrics,
    queryBriefingReturnAfterGapInsight: hoistedDb.queryBriefingReturnAfterGapInsight,
  };
});

vi.mock("@/server/dashboard-analytics-bundle-request-cache", () => ({
  readFreshDashboardAnalyticsBundleForRequest: hoistedBundle.readFreshDashboardAnalyticsBundleForRequest,
}));

vi.mock("@/server/dashboard-page-data", () => ({
  loadDashboardCompletedStats: hoistedPageData.loadDashboardCompletedStats,
}));

import { loadDashboardHomeBriefingForCompletedHome } from "./load-dashboard-home-briefing";

const job: ImportJobApiRow = {
  id: "job",
  label: "t",
  lastfm_username: "x",
  source: "user",
  stage: "completed",
  error_message: null,
  items_total: null,
  items_processed: 0,
  checkpoint_pages_completed: 0,
  checkpoint_oldest_uts: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("loadDashboardHomeBriefingForCompletedHome — VS-62 Core gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoistedDb.getUserProfileFields.mockResolvedValue({ stats_timezone: null });
  });

  it("returns the Advanced gate shell without snapshot, bundle, or rollup DB reads", async () => {
    const pool = {} as Pool;
    const out = await loadDashboardHomeBriefingForCompletedHome(pool, {
      userId: "00000000-0000-4000-8000-000000000001",
      displayName: "Pat",
      job,
      headers: new Headers(),
      allowAiLayer1Reads: false,
    });

    expect(hoistedDb.getUserProfileFields).toHaveBeenCalledWith(pool, "00000000-0000-4000-8000-000000000001");
    expect(hoistedDb.tryReadFreshHomeBriefingSnapshot).not.toHaveBeenCalled();
    expect(hoistedBundle.readFreshDashboardAnalyticsBundleForRequest).not.toHaveBeenCalled();
    expect(hoistedPageData.loadDashboardCompletedStats).not.toHaveBeenCalled();
    expect(hoistedDb.getDashboardListenSummary).not.toHaveBeenCalled();
    expect(hoistedDb.getDashboardHeroWindowMetrics).not.toHaveBeenCalled();
    expect(hoistedDb.queryBriefingReturnAfterGapInsight).not.toHaveBeenCalled();
    expect(hoistedDb.upsertHomeBriefingSnapshot).not.toHaveBeenCalled();

    expect(out.narrativeParagraphs).toHaveLength(0);
    expect(out.cards).toHaveLength(0);
    expect(out.actions).toHaveLength(0);
  });
});
