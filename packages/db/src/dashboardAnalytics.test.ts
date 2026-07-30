import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveListenPageSummaryFromDashboardAllSummary,
  archiveListensLimitFromQueryParam,
  getArchiveListensPage,
  getDashboardHeroWindowMetrics,
  getDashboardListenSummary,
  getDashboardListenSummaryArchivePageHeader,
  getDashboardRecentListens,
  getEarliestListenPlayedAtForUser,
  parseArchiveListenSourceFilter,
  parseArchiveListenTypeFilter,
  parseDashboardAnalyticsRange,
  playedAtLowerBoundUtc,
  recentListensLimitFromQueryParam,
  type DashboardAnalyticsDbExecutor,
} from "./dashboardAnalytics.js";

describe("dashboardAnalytics", () => {
  describe("parseDashboardAnalyticsRange", () => {
    it("defaults empty to 30d", () => {
      expect(parseDashboardAnalyticsRange(undefined)).toBe("30d");
      expect(parseDashboardAnalyticsRange(null)).toBe("30d");
      expect(parseDashboardAnalyticsRange("")).toBe("30d");
    });

    it("accepts supported tokens", () => {
      expect(parseDashboardAnalyticsRange("7d")).toBe("7d");
      expect(parseDashboardAnalyticsRange("90d")).toBe("90d");
      expect(parseDashboardAnalyticsRange("all")).toBe("all");
    });

    it("rejects unknown values", () => {
      expect(parseDashboardAnalyticsRange("1w")).toBeNull();
    });
  });

  describe("playedAtLowerBoundUtc", () => {
    it("returns null for all-time", () => {
      expect(playedAtLowerBoundUtc("all", 1_000_000)).toBeNull();
    });

    it("returns a cutoff in the past for bounded ranges", () => {
      const now = Date.UTC(2026, 0, 10, 12, 0, 0);
      const got = playedAtLowerBoundUtc("7d", now);
      expect(got).not.toBeNull();
      expect(got!.getTime()).toBe(now - 7 * 86_400_000);
    });
  });

  describe("recentListensLimitFromQueryParam", () => {
    it("clamps to max", () => {
      expect(recentListensLimitFromQueryParam("500")).toBe(100);
    });

    it("falls back for invalid numbers", () => {
      expect(recentListensLimitFromQueryParam("x")).toBe(50);
    });
  });

  describe("parseArchiveListenSourceFilter", () => {
    it("defaults empty to all", () => {
      expect(parseArchiveListenSourceFilter(undefined)).toBe("all");
      expect(parseArchiveListenSourceFilter("")).toBe("all");
      expect(parseArchiveListenSourceFilter("all")).toBe("all");
    });

    it("accepts supported tokens", () => {
      expect(parseArchiveListenSourceFilter("lastfm")).toBe("lastfm");
      expect(parseArchiveListenSourceFilter("import")).toBe("import");
      expect(parseArchiveListenSourceFilter("spotify")).toBe("spotify");
    });

    it("rejects unknown values", () => {
      expect(parseArchiveListenSourceFilter("apple")).toBeNull();
    });
  });

  describe("parseArchiveListenTypeFilter", () => {
    it("defaults empty to tracks", () => {
      expect(parseArchiveListenTypeFilter(undefined)).toBe("tracks");
      expect(parseArchiveListenTypeFilter("")).toBe("tracks");
      expect(parseArchiveListenTypeFilter("tracks")).toBe("tracks");
    });

    it("accepts artists and albums", () => {
      expect(parseArchiveListenTypeFilter("artists")).toBe("artists");
      expect(parseArchiveListenTypeFilter("albums")).toBe("albums");
    });

    it("rejects unknown values", () => {
      expect(parseArchiveListenTypeFilter("labels")).toBeNull();
    });
  });

  describe("archiveListensLimitFromQueryParam", () => {
    it("clamps to max", () => {
      expect(archiveListensLimitFromQueryParam("500")).toBe(100);
    });

    it("falls back for invalid numbers", () => {
      expect(archiveListensLimitFromQueryParam("x")).toBe(40);
    });
  });

  describe("getArchiveListensPage", () => {
    const query = vi.fn();
    const db = { query } as DashboardAnalyticsDbExecutor;

    beforeEach(() => {
      query.mockReset();
    });

    it("clamps page size to 100 for default limit mode", async () => {
      query.mockResolvedValueOnce({ rows: [] });
      await getArchiveListensPage(db, {
        userId: "user-uuid",
        range: "all",
        limit: 99_999,
        cursor: null,
        q: null,
        source: "all",
        type: "tracks",
      });
      const args = query.mock.calls[0]?.[1] as unknown[];
      expect(args[8]).toBe(100);
    });

    it("clamps page size to 2000 for export limit mode", async () => {
      query.mockResolvedValueOnce({ rows: [] });
      await getArchiveListensPage(db, {
        userId: "user-uuid",
        range: "all",
        limit: 99_999,
        cursor: null,
        q: null,
        source: "all",
        type: "tracks",
        limitMode: "export",
      });
      const args = query.mock.calls[0]?.[1] as unknown[];
      expect(args[8]).toBe(2000);
    });

    it("uses UTC half-open window when playedAtUtcWindow is set", async () => {
      query.mockResolvedValueOnce({ rows: [] });
      await getArchiveListensPage(db, {
        userId: "user-uuid",
        range: "all",
        limit: 40,
        cursor: null,
        q: null,
        source: "all",
        type: "tracks",
        playedAtUtcWindow: {
          gteIso: "2017-03-01T00:00:00.000Z",
          ltExclusiveIso: "2017-04-01T00:00:00.000Z",
        },
      });
      const args = query.mock.calls[0]?.[1] as unknown[];
      expect(args[1]).toBeNull();
      expect(args[9]).toBe("2017-03-01T00:00:00.000Z");
      expect(args[10]).toBe("2017-04-01T00:00:00.000Z");
      expect(args[11]).toBe(true);
    });
  });

  describe("getDashboardListenSummary", () => {
    const query = vi.fn();
    const db = { query } as DashboardAnalyticsDbExecutor;

    beforeEach(() => {
      query.mockReset();
    });

    it("runs four parallel queries scoped to user and optional cutoff", async () => {
      query
        .mockResolvedValueOnce({ rows: [{ c: 3 }] })
        .mockResolvedValueOnce({
          rows: [
            { artist_id: "a1", name: "A", plays: 2 },
            { artist_id: "a2", name: "B", plays: 1 },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              track_id: "t1",
              title: "Song",
              artist_name: "A",
              plays: 3,
              musicbrainz_release_mbid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001",
              lastfm_cover_image_url: null,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              album_id: "al1",
              title: "LP",
              artist_name: "A",
              plays: 2,
              musicbrainz_release_mbid: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbb001",
              lastfm_cover_image_url: null,
            },
          ],
        });

      const fixedNow = Date.UTC(2026, 3, 1, 0, 0, 0);
      const out = await getDashboardListenSummary(db, {
        userId: "user-uuid",
        range: "30d",
        topLimit: 5,
        nowMs: fixedNow,
      });

      expect(out.range).toBe("30d");
      expect(out.total_scrobbles).toBe(3);
      expect(out.top_artists).toHaveLength(2);
      expect(out.top_tracks[0]?.track_id).toBe("t1");
      expect(out.top_tracks[0]?.musicbrainz_release_mbid).toBe(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001",
      );
      expect(out.top_albums[0]?.album_id).toBe("al1");
      expect(out.top_albums[0]?.musicbrainz_release_mbid).toBe(
        "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbb001",
      );
      expect(query).toHaveBeenCalledTimes(4);

      const since = playedAtLowerBoundUtc("30d", fixedNow);
      for (const call of query.mock.calls) {
        const sql = String(call[0]);
        const args = call[1] as unknown[];
        expect(sql.toLowerCase()).toContain("from listens");
        expect(args[0]).toBe("user-uuid");
        expect(args[1]).toEqual(since);
        expect(args[2]).toBeNull();
      }

      const topCallArgs = query.mock.calls[1]?.[1] as unknown[];
      expect(topCallArgs[3]).toBe(5);

      const albumsSql = String(
        query.mock.calls.find((c) => String(c[0]).includes("group by al.id"))?.[0] ?? "",
      );
      expect(albumsSql).toContain("ar_track");
      expect(albumsSql).toContain("rs.artist_name");
      expect(albumsSql).toContain("rs.album_mbid");
    });
  });

  describe("archiveListenPageSummaryFromDashboardAllSummary", () => {
    it("maps total, first top artist, first top album, and inferred artist cover", () => {
      const out = archiveListenPageSummaryFromDashboardAllSummary({
        range: "all",
        total_scrobbles: 12,
        top_artists: [
          { artist_id: "a1", name: "One", plays: 5 },
          { artist_id: "a2", name: "Two", plays: 3 },
        ],
        top_tracks: [
          {
            track_id: "t",
            title: "Hit",
            artist_name: "One",
            plays: 4,
            musicbrainz_release_mbid: "mbid-hit",
            lastfm_cover_image_url: null,
          },
        ],
        top_albums: [
          {
            album_id: "al1",
            title: "Long Player",
            artist_name: "One",
            plays: 3,
            musicbrainz_release_mbid: "mbid-lp",
            lastfm_cover_image_url: null,
          },
        ],
      });
      expect(out.total_scrobbles).toBe(12);
      expect(out.top_artist?.name).toBe("One");
      expect(out.top_album?.title).toBe("Long Player");
      expect(out.top_artist_cover?.musicbrainz_release_mbid).toBe("mbid-hit");
    });
  });

  describe("getDashboardListenSummaryArchivePageHeader", () => {
    const query = vi.fn();
    const db = { query } as DashboardAnalyticsDbExecutor;

    beforeEach(() => {
      query.mockReset();
    });

    it("runs total + top-artist + top-album statements and returns ArchiveListenPageSummary", async () => {
      query
        .mockResolvedValueOnce({ rows: [{ c: 99 }] })
        .mockResolvedValueOnce({
          rows: [{ artist_id: "md5x", name: "Solo", plays: 99 }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              album_id: "al1",
              title: "Debut",
              artist_name: "Solo",
              plays: 40,
              musicbrainz_release_mbid: "r-mbid",
              lastfm_cover_image_url: "https://last.fm/cover.jpg",
            },
          ],
        });

      const out = await getDashboardListenSummaryArchivePageHeader(db, {
        userId: "user-uuid",
        nowMs: Date.UTC(2026, 3, 1, 0, 0, 0),
      });

      expect(out.total_scrobbles).toBe(99);
      expect(out.top_artist?.name).toBe("Solo");
      expect(out.top_artist?.plays).toBe(99);
      expect(out.top_album?.title).toBe("Debut");
      expect(out.top_artist_cover?.musicbrainz_release_mbid).toBe("r-mbid");
      expect(query).toHaveBeenCalledTimes(3);
    });
  });

  describe("getDashboardRecentListens", () => {
    const query = vi.fn();
    const db = { query } as DashboardAnalyticsDbExecutor;

    beforeEach(() => {
      query.mockReset();
    });

    it("orders newest first and binds limit", async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            listen_id: "l2",
            played_at: "2026-01-02T00:00:00.000Z",
            track_id: "t",
            track_title: "Later",
            artist_name: "Ar",
            album_id: null,
            album_title: null,
            musicbrainz_release_mbid: null,
            lastfm_cover_image_url: null,
          },
          {
            listen_id: "l1",
            played_at: "2026-01-01T00:00:00.000Z",
            track_id: "t",
            track_title: "Earlier",
            artist_name: "Ar",
            album_id: null,
            album_title: null,
            musicbrainz_release_mbid: null,
            lastfm_cover_image_url: null,
          },
        ],
      });

      const fixedNow = Date.UTC(2026, 3, 1, 0, 0, 0);
      const rows = await getDashboardRecentListens(db, {
        userId: "u1",
        range: "all",
        limit: 20,
        nowMs: fixedNow,
      });

      expect(rows[0]?.listen_id).toBe("l2");
      expect(query).toHaveBeenCalledTimes(1);
      const sql = String(query.mock.calls[0]?.[0]);
      expect(sql.toLowerCase()).toContain("order by l.played_at desc");
      expect(sql).toContain("rs.album_name");
      expect(sql).toContain("rs.album_mbid");
      const args = query.mock.calls[0]?.[1] as unknown[];
      expect(args).toEqual(["u1", null, 20]);
    });
  });

  describe("getDashboardHeroWindowMetrics", () => {
    const query = vi.fn();
    const db = { query } as DashboardAnalyticsDbExecutor;

    beforeEach(() => {
      query.mockReset();
    });

    it("loads bounded window weekday + daily timeline in parallel", async () => {
      query
        .mockResolvedValueOnce({ rows: [{ utc_weekday: 2, plays: 40 }] })
        .mockResolvedValueOnce({
          rows: [
            { period_start: "2026-03-30", count: 1 },
            { period_start: "2026-03-31", count: 0 },
          ],
        });

      const fixedNow = Date.UTC(2026, 2, 31, 12, 0, 0);
      const out = await getDashboardHeroWindowMetrics(db, {
        userId: "user-uuid",
        range: "7d",
        nowMs: fixedNow,
      });

      expect(out.weekday_peak).toEqual({ utc_weekday: 2, plays: 40 });
      expect(out.timeline_grain).toBe("utc_day");
      expect(out.timeline).toHaveLength(2);
      expect(query).toHaveBeenCalledTimes(2);
      const weekdaySql = String(query.mock.calls[0]?.[0] ?? "");
      expect(weekdaySql.toLowerCase()).toContain("extract(dow");
      const timelineSql = String(query.mock.calls[1]?.[0] ?? "");
      expect(timelineSql.toLowerCase()).toContain("generate_series");
      const since = playedAtLowerBoundUtc("7d", fixedNow);
      expect(query.mock.calls[1]?.[1]).toEqual([
        "user-uuid",
        "2026-03-24",
        "2026-03-31",
        since,
        new Date(fixedNow),
        "UTC",
      ]);
    });

    it("loads all-time weekday + capped monthly timeline", async () => {
      query
        .mockResolvedValueOnce({ rows: [{ utc_weekday: 5, plays: 1200 }] })
        .mockResolvedValueOnce({
          rows: [{ period_start: "2026-01-01", count: 50 }],
        });

      const out = await getDashboardHeroWindowMetrics(db, {
        userId: "user-uuid",
        range: "all",
        nowMs: Date.UTC(2026, 3, 1, 0, 0, 0),
      });

      expect(out.weekday_peak).toEqual({ utc_weekday: 5, plays: 1200 });
      expect(out.timeline_grain).toBe("utc_month");
      expect(out.timeline[0]?.period_start).toBe("2026-01-01");
      expect(query.mock.calls[0]?.[1]).toEqual(["user-uuid", "UTC"]);
      expect(String(query.mock.calls[1]?.[0] ?? "").toLowerCase()).toContain("limit 60");
    });
  });

  describe("getEarliestListenPlayedAtForUser", () => {
    it("returns null when no listens exist", async () => {
      const db: DashboardAnalyticsDbExecutor = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };
      await expect(getEarliestListenPlayedAtForUser(db, "u1")).resolves.toBeNull();
    });

    it("returns ISO timestamp from earliest row", async () => {
      const db: DashboardAnalyticsDbExecutor = {
        query: vi.fn().mockResolvedValue({
          rows: [{ played_at: new Date("2020-01-02T00:00:00.000Z") }],
        }),
      };
      await expect(getEarliestListenPlayedAtForUser(db, "u1")).resolves.toBe(
        "2020-01-02T00:00:00.000Z",
      );
    });
  });
});
