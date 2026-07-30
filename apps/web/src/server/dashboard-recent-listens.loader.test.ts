import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetUserScopedReadCacheForTests } from "@/server/user-scoped-ttl-read-cache";
import type { Pool } from "pg";

const recentListensMocks = vi.hoisted(() => ({
  getDashboardRecentListens: vi.fn().mockResolvedValue([]),
}));

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    tryReadFreshDashboardAnalyticsBundle: vi.fn().mockResolvedValue(null),
    getDashboardRecentListens: recentListensMocks.getDashboardRecentListens,
  };
});

import { loadDashboardRecentListens } from "./dashboard-page-data";

const fakePool = {} as Pool;
const userId = "00000000-0000-4000-8000-000000000002";

describe("loadDashboardRecentListens", () => {
  beforeEach(() => {
    resetUserScopedReadCacheForTests();
  });

  it("loads recent listens for the requested range", async () => {
    vi.clearAllMocks();
    await loadDashboardRecentListens(fakePool, userId, "7d", { allowAiLayer1Reads: true });
    expect(recentListensMocks.getDashboardRecentListens).toHaveBeenCalledWith(
      fakePool,
      expect.objectContaining({ userId, range: "7d", limit: 12 }),
    );
  });
});
