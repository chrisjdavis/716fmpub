import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetUserScopedReadCacheForTests } from "@/server/user-scoped-ttl-read-cache";

const hoisted = vi.hoisted(() => ({
  tryReadFreshDashboardAnalyticsBundle: vi.fn(),
  getArchiveListensPage: vi.fn().mockResolvedValue([]),
}));

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    tryReadFreshDashboardAnalyticsBundle: hoisted.tryReadFreshDashboardAnalyticsBundle,
    getArchiveListensPage: hoisted.getArchiveListensPage,
    getDashboardListenSummaryArchivePageHeader: vi.fn(async () => ({
      total_scrobbles: 3,
      top_artist: { artist_id: "a1", name: "Artist", plays: 3 },
      top_album: null,
      top_artist_cover: null,
    })),
    getEarliestListenPlayedAtForUser: vi.fn(async () => "2011-06-01T00:00:00.000Z"),
  };
});

import { loadArchivePageData } from "./archive-page-data";

const fakePool = {} as Pool;
const userId = "00000000-0000-4000-8000-000000000099";

describe("loadArchivePageData — VS-65 Core plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.tryReadFreshDashboardAnalyticsBundle.mockReset();
    hoisted.tryReadFreshDashboardAnalyticsBundle.mockResolvedValue(null);
    resetUserScopedReadCacheForTests();
  });

  it("does not read dashboard_bundle when allowAiLayer1Reads is false", async () => {
    await loadArchivePageData(fakePool, userId, {
      utcArchiveMonthYyyMm: null,
      allowAiLayer1Reads: false,
    });
    expect(hoisted.tryReadFreshDashboardAnalyticsBundle).not.toHaveBeenCalled();
    expect(hoisted.getArchiveListensPage).toHaveBeenCalled();
  });

  it("does not read dashboard_bundle when options omit allowAiLayer1Reads (defaults off)", async () => {
    hoisted.tryReadFreshDashboardAnalyticsBundle.mockClear();
    await loadArchivePageData(fakePool, userId, { utcArchiveMonthYyyMm: null });
    expect(hoisted.tryReadFreshDashboardAnalyticsBundle).not.toHaveBeenCalled();
  });
});
