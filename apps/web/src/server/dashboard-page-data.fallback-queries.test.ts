import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetUserScopedReadCacheForTests } from "@/server/user-scoped-ttl-read-cache";
import type { Pool } from "pg";
import type { ImportJobRecord } from "@vs/db";
import { getDashboardRecentListens } from "@vs/db";

const summaryRanges: string[] = [];

const dashboardDbMocks = vi.hoisted(() => ({
  tryReadFreshDashboardAnalyticsBundle: vi.fn().mockResolvedValue(null),
}));

function completedImport(): ImportJobRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-000000000002",
    label: "Test import",
    lastfm_username: "example_user",
    source: "user",
    stage: "completed",
    error_message: null,
    items_total: 100,
    items_processed: 100,
    checkpoint_pages_completed: 1,
    checkpoint_oldest_uts: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
  };
}

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    tryReadFreshDashboardAnalyticsBundle: dashboardDbMocks.tryReadFreshDashboardAnalyticsBundle,
    getDashboardListenSummary: vi.fn(
      async (_pool: Pool, input: { userId: string; range: string }) => {
        summaryRanges.push(input.range);
        return {
          range: input.range,
          total_scrobbles: 42,
          top_artists: [{ artist_id: "a1", name: "Artist", plays: 9 }],
          top_tracks: [],
          top_albums: [],
        };
      },
    ),
    getDashboardRecentListens: vi.fn(async () => []),
    getDashboardHeroWindowMetrics: vi.fn(async () => ({
      weekday_peak: null,
      timeline_grain: "utc_day" as const,
      timeline: [],
    })),
    getUserProfileFields: vi.fn(async () => ({ lastfm_username: "u" })),
    getLatestDashboardImportJobForUser: vi.fn(async () => completedImport()),
  };
});

import { withDashboardRequestContext } from "./dashboard-request-context";
import {
  loadDashboardPageData,
  loadDashboardRecentListens,
  loadDashboardRouteBootstrap,
} from "./dashboard-page-data";

const fakePool = {} as Pool;
const userId = "00000000-0000-4000-8000-000000000002";

describe("loadDashboardPageData (no bundle fallback)", () => {
  beforeEach(() => {
    summaryRanges.length = 0;
    vi.clearAllMocks();
    resetUserScopedReadCacheForTests();
  });

  it("requests getDashboardListenSummary once for all when the dashboard range is all", async () => {
    await loadDashboardPageData(fakePool, userId, "all");
    expect(summaryRanges).toEqual(["all"]);
  });

  it("requests only the windowed summary when range is not all (no extra all-time fetch)", async () => {
    await loadDashboardPageData(fakePool, userId, "30d");
    expect(summaryRanges).toEqual(["30d"]);
  });

  it("does not load recent listens in the primary dashboard query batch", async () => {
    vi.clearAllMocks();
    await loadDashboardPageData(fakePool, userId, "30d");
    expect(vi.mocked(getDashboardRecentListens)).not.toHaveBeenCalled();
  });

  it("reads tryReadFreshDashboardAnalyticsBundle once when main and recent loaders run under dashboard request context", async () => {
    vi.clearAllMocks();
    await withDashboardRequestContext(async () => {
      await loadDashboardPageData(fakePool, userId, "30d", { allowAiLayer1Reads: true });
      await loadDashboardRecentListens(fakePool, userId, "30d", { allowAiLayer1Reads: true });
    });
    expect(dashboardDbMocks.tryReadFreshDashboardAnalyticsBundle).toHaveBeenCalledTimes(1);
  });

  it("does not request listen summaries during dashboard route bootstrap alone", async () => {
    summaryRanges.length = 0;
    vi.clearAllMocks();
    const boot = await loadDashboardRouteBootstrap(fakePool, userId);
    expect(boot.kind).toBe("completed_pending");
    expect(summaryRanges).toEqual([]);
  });

  it("does not read dashboard_bundle when allowAiLayer1Reads is omitted on loadDashboardPageData", async () => {
    vi.clearAllMocks();
    await withDashboardRequestContext(async () => {
      await loadDashboardPageData(fakePool, userId, "30d");
    });
    expect(dashboardDbMocks.tryReadFreshDashboardAnalyticsBundle).not.toHaveBeenCalled();
  });
});
