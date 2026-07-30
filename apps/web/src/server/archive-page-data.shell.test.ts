import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetUserScopedReadCacheForTests } from "@/server/user-scoped-ttl-read-cache";
import type { Pool } from "pg";

const archivePageMocks = vi.hoisted(() => ({
  getArchiveListensPage: vi.fn().mockResolvedValue([]),
  tryReadFreshDashboardAnalyticsBundle: vi.fn().mockResolvedValue(null),
}));

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    tryReadFreshDashboardAnalyticsBundle: archivePageMocks.tryReadFreshDashboardAnalyticsBundle,
    getDashboardListenSummaryArchivePageHeader: vi.fn(async () => ({
      total_scrobbles: 3,
      top_artist: { artist_id: "a1", name: "Artist", plays: 3 },
      top_album: null,
      top_artist_cover: null,
    })),
    getEarliestListenPlayedAtForUser: vi.fn(async () => "2011-06-01T00:00:00.000Z"),
    getArchiveListensPage: archivePageMocks.getArchiveListensPage,
  };
});

import { loadArchivePageData, loadArchivePageShell } from "./archive-page-data";

const fakePool = {} as Pool;
const userId = "00000000-0000-4000-8000-000000000002";

describe("loadArchivePageShell", () => {
  beforeEach(() => {
    archivePageMocks.getArchiveListensPage.mockClear();
    archivePageMocks.tryReadFreshDashboardAnalyticsBundle.mockClear();
    resetUserScopedReadCacheForTests();
  });

  it("does not run the keyset archive listens query", async () => {
    await loadArchivePageShell(fakePool, userId);
    expect(archivePageMocks.getArchiveListensPage).not.toHaveBeenCalled();
  });

  it("does not read dashboard_bundle when allowAiLayer1Reads is omitted (VS-88 default)", async () => {
    await loadArchivePageShell(fakePool, userId);
    expect(archivePageMocks.tryReadFreshDashboardAnalyticsBundle).not.toHaveBeenCalled();
  });

  it("attempts dashboard_bundle read when allowAiLayer1Reads is true", async () => {
    await loadArchivePageShell(fakePool, userId, { allowAiLayer1Reads: true });
    expect(archivePageMocks.tryReadFreshDashboardAnalyticsBundle).toHaveBeenCalledTimes(1);
  });
});

describe("loadArchivePageData", () => {
  beforeEach(() => {
    archivePageMocks.getArchiveListensPage.mockClear();
    archivePageMocks.tryReadFreshDashboardAnalyticsBundle.mockClear();
    resetUserScopedReadCacheForTests();
  });

  it("still loads the first archive page in parallel with the shell fields", async () => {
    const data = await loadArchivePageData(fakePool, userId);
    expect(archivePageMocks.getArchiveListensPage).toHaveBeenCalledTimes(1);
    expect(data.utcArchiveMonthYyyMm).toBeNull();
  });

  it("does not read dashboard_bundle when allowAiLayer1Reads is omitted (VS-88 default)", async () => {
    await loadArchivePageData(fakePool, userId);
    expect(archivePageMocks.tryReadFreshDashboardAnalyticsBundle).not.toHaveBeenCalled();
  });
});
