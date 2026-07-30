import { describe, expect, it } from "vitest";
import {
  buildTimeMachineExploreCopy,
  formatNewAroundHereValue,
} from "./dashboard-time-machine-briefing";
import { exploreNarrativePlainText } from "./time-machine-explore-narrative";

const baseMetrics = {
  period_start: "2017-04-01",
  play_count: 40,
  unique_track_count: 20,
  unique_artist_count: 10,
  unique_album_count: 5,
  top_artist_name: "Stereolab",
  top_artist_plays: 12,
  top_track_title: "Jenny Ondioline",
  top_track_plays: 5,
} as const;

describe("buildTimeMachineExploreCopy", () => {
  it("returns empty modules when there are no plays", () => {
    const got = buildTimeMachineExploreCopy({
      monthYyyMm: "2017-03",
      metrics: null,
      prior: null,
      newArtistCount: 0,
    });
    expect(got.modules.length).toBe(0);
    expect(got.contextStrip).toEqual([]);
    expect(got.detailLines).toEqual([]);
    expect(got.comparisonNarrative).toBeNull();
    expect(got.continuityNarrative).toBeNull();
    expect(exploreNarrativePlainText(got.primaryNarrative)).toMatch(/no listening/i);
  });

  it("omits comparison when prior month is too thin", () => {
    const got = buildTimeMachineExploreCopy({
      monthYyyMm: "2017-04",
      metrics: { ...baseMetrics },
      prior: {
        period_start: "2017-03-01",
        play_count: 3,
        unique_track_count: 3,
        unique_artist_count: 2,
        unique_album_count: 1,
        top_artist_name: "B",
        top_artist_plays: 2,
        top_track_title: null,
        top_track_plays: null,
      },
      newArtistCount: 0,
    });
    expect(got.comparisonNarrative).toBeNull();
    expect(got.detailLines[0]).toBe("40 plays · 10 artists · 20 tracks · 5 albums");
    expect(got.detailLines.some((l) => l.includes("plays per day"))).toBe(true);
    expect(got.contextStrip).toHaveLength(1);
    expect(got.contextStrip[0]).toMatch(/40 plays/);
    expect(got.contextStrip[0]).toMatch(/plays\/day/);
    expect(got.summaryLine).toBeTruthy();
  });

  it("always returns exactly three support cards when the month has plays", () => {
    const got = buildTimeMachineExploreCopy({
      monthYyyMm: "2017-04",
      metrics: { ...baseMetrics },
      prior: null,
      newArtistCount: 0,
    });
    expect(got.modules).toHaveLength(3);
    expect(got.modules.every((m) => m.tag && m.value && m.meta && m.tagKey)).toBe(true);
  });

  it("names new artists on NEW AROUND HERE instead of a vague count", () => {
    const got = buildTimeMachineExploreCopy({
      monthYyyMm: "2017-04",
      metrics: { ...baseMetrics },
      prior: null,
      newArtistCount: 3,
      newArtistsRanked: [
        { name: "Sade", playsInPeriod: 8 },
        { name: "Talk Talk", playsInPeriod: 4 },
        { name: "XTC", playsInPeriod: 2 },
      ],
    });
    const novelty = got.modules.find((m) => m.tag === "NEW AROUND HERE");
    expect(novelty).toBeTruthy();
    expect(novelty!.value).toMatch(/Sade/);
    expect(novelty!.value).toMatch(/Talk Talk/);
    expect(novelty!.value).toMatch(/XTC/);
    expect(novelty!.value).not.toMatch(/^\d+ artists/);
    expect(novelty!.value.toLowerCase()).not.toContain("several");
  });

  it("formats many new artists as two names plus others", () => {
    const got = buildTimeMachineExploreCopy({
      monthYyyMm: "2017-04",
      metrics: { ...baseMetrics },
      prior: null,
      newArtistCount: 8,
      newArtistsRanked: [
        { name: "Sade", playsInPeriod: 10 },
        { name: "Talk Talk", playsInPeriod: 6 },
        { name: "Zebra", playsInPeriod: 1 },
      ],
    });
    const novelty = got.modules.find((m) => m.tag === "NEW AROUND HERE");
    expect(novelty).toBeTruthy();
    expect(novelty!.value).toMatch(/Sade/);
    expect(novelty!.value).toMatch(/Talk Talk/);
    expect(novelty!.value).toMatch(/6 others/);
  });

  it("does not emit NEW AROUND HERE when there are no resolvable artist names", () => {
    const got = buildTimeMachineExploreCopy({
      monthYyyMm: "2017-04",
      metrics: { ...baseMetrics },
      prior: null,
      newArtistCount: 24,
      newArtistsRanked: [],
    });
    expect(got.modules.find((m) => m.tag === "NEW AROUND HERE")).toBeUndefined();
    expect(got.modules).toHaveLength(3);
  });

  it("keeps three distinct cards when novelty is absent", () => {
    const got = buildTimeMachineExploreCopy({
      monthYyyMm: "2017-04",
      metrics: { ...baseMetrics },
      prior: null,
      newArtistCount: 0,
    });
    const tags = got.modules.map((m) => m.tag);
    expect(new Set(tags).size).toBe(3);
  });

  it("puts year and YoY rollups in detail lines, not the context strip", () => {
    const got = buildTimeMachineExploreCopy({
      monthYyyMm: "2017-04",
      metrics: { ...baseMetrics },
      prior: null,
      sameMonthPriorYear: {
        period_start: "2016-04-01",
        play_count: 40,
        unique_track_count: 18,
        unique_artist_count: 9,
        unique_album_count: 4,
        top_artist_name: "X",
        top_artist_plays: 10,
        top_track_title: "Y",
        top_track_plays: 4,
      },
      yearMetrics: {
        period_start: "2017-01-01",
        play_count: 400,
        unique_track_count: 200,
        unique_artist_count: 80,
        unique_album_count: 40,
        top_artist_name: "Z",
        top_artist_plays: 50,
        top_track_title: "T",
        top_track_plays: 20,
      },
      newArtistCount: 0,
    });
    const joinedDetail = got.detailLines.join(" ");
    expect(joinedDetail).toMatch(/2017 calendar year/);
    expect(joinedDetail).toMatch(/400/);
    expect(joinedDetail).toMatch(/April 2016/);
    expect(got.contextStrip.join(" ")).not.toMatch(/calendar year/);
  });
});

describe("formatNewAroundHereValue", () => {
  it("lists one name", () => {
    expect(formatNewAroundHereValue(["Sade"], 1)).toBe("Sade");
  });

  it("lists two names", () => {
    expect(formatNewAroundHereValue(["Sade", "Talk Talk"], 2)).toBe("Sade and Talk Talk");
  });

  it("lists three names", () => {
    expect(formatNewAroundHereValue(["Sade", "Talk Talk", "XTC"], 3)).toBe("Sade, Talk Talk, and XTC");
  });

  it("uses two names and an others count", () => {
    expect(formatNewAroundHereValue(["Sade", "Talk Talk", "XTC"], 8)).toBe(
      "Sade, Talk Talk, and 6 others",
    );
  });

  it("returns null without names", () => {
    expect(formatNewAroundHereValue([], 3)).toBeNull();
  });
});
