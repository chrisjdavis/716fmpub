import { describe, expect, it } from "vitest";
import type { DashboardListenSummary } from "@vs/db";
import { sanitizeDashboardListenSummaryForPublicApi } from "./sanitize-dashboard-listen-summary";

function minimalSummary(overrides: Partial<DashboardListenSummary> = {}): DashboardListenSummary {
  return {
    range: "30d",
    total_scrobbles: 0,
    top_artists: [],
    top_tracks: [],
    top_albums: [],
    ...overrides,
  };
}

describe("sanitizeDashboardListenSummaryForPublicApi", () => {
  it("VS-51 follow-up: strips NUL and bidi marks from top artist, track, and album display strings", () => {
    const out = sanitizeDashboardListenSummaryForPublicApi(
      minimalSummary({
        top_artists: [{ artist_id: "a1", name: "A\u0000B\u202EC", plays: 1 }],
        top_tracks: [
          {
            track_id: "t1",
            title: "T\u0001itle",
            artist_name: "Ar\u202Etist",
            plays: 2,
            musicbrainz_release_mbid: null,
            lastfm_cover_image_url: null,
          },
        ],
        top_albums: [
          {
            album_id: "b1",
            title: "Alb\u0000um",
            artist_name: "Owner",
            plays: 3,
            musicbrainz_release_mbid: null,
            lastfm_cover_image_url: null,
          },
        ],
      }),
    );
    expect(out.top_artists[0]?.name).toBe("ABC");
    expect(out.top_tracks[0]?.title).toBe("T itle");
    expect(out.top_tracks[0]?.artist_name).toBe("Artist");
    expect(out.top_albums[0]?.title).toBe("Album");
    expect(out.top_albums[0]?.artist_name).toBe("Owner");
  });

  it("preserves numeric fields and range token", () => {
    const s = minimalSummary({
      range: "all",
      total_scrobbles: 99,
      top_artists: [{ artist_id: "x", name: "n", plays: 5 }],
    });
    const out = sanitizeDashboardListenSummaryForPublicApi(s);
    expect(out.range).toBe("all");
    expect(out.total_scrobbles).toBe(99);
    expect(out.top_artists[0]?.plays).toBe(5);
    expect(out.top_artists[0]?.artist_id).toBe("x");
  });
});
