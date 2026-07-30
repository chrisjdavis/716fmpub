import { describe, expect, it } from "vitest";
import {
  displayUtcWeekdayPeak,
  inWindowBehaviorInsight,
  mostActiveUtcWeekdayFromRecent,
  replayBehaviorFromSummary,
} from "./dashboard-window-behavior";
import type { DashboardListenSummary } from "@vs/db";

function summaryStub(partial: Partial<DashboardListenSummary>): DashboardListenSummary {
  return {
    range: "30d",
    total_scrobbles: 0,
    top_artists: [],
    top_tracks: [],
    top_albums: [],
    ...partial,
  };
}

describe("displayUtcWeekdayPeak", () => {
  it("returns null for null peak", () => {
    expect(displayUtcWeekdayPeak(null)).toBeNull();
  });

  it("maps SQL dow to label", () => {
    expect(displayUtcWeekdayPeak({ utc_weekday: 2, plays: 25 })).toEqual({
      name: "Tuesday",
      count: 25,
    });
  });
});

describe("mostActiveUtcWeekdayFromRecent", () => {
  it("returns null for empty input", () => {
    expect(mostActiveUtcWeekdayFromRecent([])).toBeNull();
  });

  it("picks the UTC weekday with the highest count", () => {
    // 2026-04-14 is Tuesday UTC
    const listens = [
      { played_at: "2026-04-14T12:00:00.000Z" },
      { played_at: "2026-04-14T13:00:00.000Z" },
      { played_at: "2026-04-13T12:00:00.000Z" }, // Monday
    ];
    expect(mostActiveUtcWeekdayFromRecent(listens)).toEqual({
      name: "Tuesday",
      count: 2,
    });
  });
});

describe("replayBehaviorFromSummary", () => {
  it("handles zero plays", () => {
    const s = summaryStub({ total_scrobbles: 0 });
    expect(replayBehaviorFromSummary(s).title).toBe("—");
  });

  it("returns high repetition when top track dominates", () => {
    const s = summaryStub({
      total_scrobbles: 100,
      top_tracks: [
        {
          track_id: "1",
          title: "A",
          artist_name: "X",
          plays: 20,
          musicbrainz_release_mbid: null,
          lastfm_cover_image_url: null,
        },
      ],
    });
    expect(replayBehaviorFromSummary(s).title).toBe("High repetition");
  });
});

describe("inWindowBehaviorInsight", () => {
  it("returns empty-window copy", () => {
    expect(inWindowBehaviorInsight(summaryStub({ total_scrobbles: 0 }))).toContain("Once this window");
  });

  it("returns null when plays are spread without a standout top track", () => {
    const s = summaryStub({
      total_scrobbles: 100,
      top_tracks: [
        {
          track_id: "1",
          title: "A",
          artist_name: "X",
          plays: 3,
          musicbrainz_release_mbid: null,
          lastfm_cover_image_url: null,
        },
      ],
    });
    expect(inWindowBehaviorInsight(s)).toBeNull();
  });
});
