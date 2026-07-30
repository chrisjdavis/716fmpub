import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardListenSummary } from "@vs/db";

const hoisted = vi.hoisted(() => ({
  readCachedCanonicalDashboardListenSummary: vi.fn(),
  tryReadFreshDashboardAnalyticsBundle: vi.fn(),
}));

vi.mock("@/server/cached-read-heavy-queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/cached-read-heavy-queries")>();
  return {
    ...actual,
    readCachedCanonicalDashboardListenSummary: hoisted.readCachedCanonicalDashboardListenSummary,
  };
});

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    tryReadFreshDashboardAnalyticsBundle: hoisted.tryReadFreshDashboardAnalyticsBundle,
  };
});

import { loadArchiveListenHighlightsForEntitledWindow } from "./archive-page-data";

describe("loadArchiveListenHighlightsForEntitledWindow — VS-65 Core gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns play count only for Core and does not read dashboard_bundle", async () => {
    const pool = {} as Pool;
    const summary = {
      total_scrobbles: 91,
      top_artists: [{ name: "Hidden", plays: 50, musicbrainz_artist_mbid: null }],
      top_tracks: [],
      top_albums: [],
    } as unknown as DashboardListenSummary;
    hoisted.readCachedCanonicalDashboardListenSummary.mockResolvedValue({
      summary,
      read_cache: {
        namespace: "analytics_summary_canonical",
        served_from: "miss",
        max_stale_seconds: 120,
      },
    });

    const out = await loadArchiveListenHighlightsForEntitledWindow(pool, "00000000-0000-4000-8000-000000000001", {
      analyticsRange: "30d",
      utcArchiveMonthYyyMm: null,
      allowAiLayer1Reads: false,
    });

    expect(hoisted.tryReadFreshDashboardAnalyticsBundle).not.toHaveBeenCalled();
    expect(hoisted.readCachedCanonicalDashboardListenSummary).toHaveBeenCalledTimes(1);
    expect(out).toEqual({
      total_scrobbles: 91,
      top_artist: null,
      top_album: null,
      top_artist_cover: null,
    });
  });
});
