import type { DashboardHeroWindowMetrics, DashboardListenSummary } from "@vs/db";
import { describe, expect, it } from "vitest";
import {
  buildDashboardHomeAdvancedGateBriefing,
  buildDashboardHomeBriefing,
  formatBriefingCalendarHeadingUtc,
  greetingFirstName,
  isFridayUtc,
  parseDashboardHomeBriefingFromJson,
} from "./dashboard-home-briefing";

/** Thursday UTC — avoids Friday weekly branch in weekday assertions. */
const thursdayNoonUtc = Date.parse("2026-04-16T12:00:00.000Z");
/** Friday UTC — weekly briefing + yesterday snapshot. */
const fridayNoonUtc = Date.parse("2026-04-17T12:00:00.000Z");

function baseSummary(
  overrides: Partial<DashboardListenSummary> = {},
): DashboardListenSummary {
  return {
    range: "7d",
    total_scrobbles: 12,
    top_artists: [{ artist_id: "a1", name: "Radiohead", plays: 8 }],
    top_tracks: [
      {
        track_id: "t1",
        title: "Everything In Its Right Place",
        artist_name: "Radiohead",
        plays: 4,
        musicbrainz_release_mbid: null,
        lastfm_cover_image_url: null,
      },
    ],
    top_albums: [],
    ...overrides,
  };
}

const baseHero: DashboardHeroWindowMetrics = {
  weekday_peak: { utc_weekday: 3, plays: 5 },
  timeline_grain: "utc_day",
  timeline: [
    { period_start: "2026-04-14", count: 1 },
    { period_start: "2026-04-15", count: 2 },
    { period_start: "2026-04-16", count: 4 },
    { period_start: "2026-04-17", count: 1 },
  ],
};

const utcBriefingOpts = {
  calendarTimeZone: "UTC",
  priorWeekSummary: baseSummary({ total_scrobbles: 10, top_artists: [{ artist_id: "x", name: "X", plays: 5 }] }),
  yearAgoSummary: baseSummary({
    total_scrobbles: 40,
    top_artists: [{ artist_id: "old", name: "Fleetwood Mac", plays: 20 }],
  }),
  localHour: 12,
} as const;

describe("greetingFirstName", () => {
  it("returns first token", () => {
    expect(greetingFirstName("Chris Davis")).toBe("Chris");
  });

  it("returns null when empty", () => {
    expect(greetingFirstName(null)).toBeNull();
    expect(greetingFirstName("   ")).toBeNull();
  });
});

describe("formatBriefingCalendarHeadingUtc", () => {
  it("formats month and day in UTC", () => {
    expect(formatBriefingCalendarHeadingUtc(thursdayNoonUtc)).toMatch(/April/);
    expect(formatBriefingCalendarHeadingUtc(thursdayNoonUtc)).toMatch(/16/);
  });
});

describe("isFridayUtc", () => {
  it("detects Friday in UTC", () => {
    expect(isFridayUtc(fridayNoonUtc)).toBe(true);
    expect(isFridayUtc(thursdayNoonUtc)).toBe(false);
  });
});

describe("buildDashboardHomeBriefing", () => {
  it("returns empty-state narrative when there are no plays", () => {
    const out = buildDashboardHomeBriefing({
      nowMs: thursdayNoonUtc,
      displayName: "Chris",
      summary: baseSummary({ total_scrobbles: 0, top_artists: [], top_tracks: [] }),
      heroWindow: baseHero,
      calendarTimeZone: "UTC",
    });
    expect(out.greetingLine1).toBe("Welcome back, Chris.");
    expect(out.scope).toBe("daily");
    expect(out.narrativeParagraphs.flatMap((p) => p.map((s) => s.text)).join("")).toContain(
      "have not logged any plays",
    );
    expect(out.cards[0]?.title).toBe("—");
    expect(out.actions.length).toBe(3);
  });

  it("weekday: accent on tracks-yesterday and update-style date headline", () => {
    const out = buildDashboardHomeBriefing({
      nowMs: thursdayNoonUtc,
      displayName: null,
      summary: baseSummary(),
      heroWindow: baseHero,
      ...utcBriefingOpts,
    });
    expect(out.scope).toBe("daily");
    expect(out.dateHeadline).toContain("Here's your update for");
    expect(out.dateHeadline).toContain("Thursday");
    const flat = out.narrativeParagraphs.flatMap((p) => p);
    const joined = flat.map((s) => s.text).join("");
    expect(joined).toContain("yesterday");
    expect(flat.some((s) => s.kind === "accent" && s.text.includes("tracks yesterday"))).toBe(
      true,
    );
    // Narrative already centers Radiohead — support cards avoid a redundant top-artist tile; prefer
    // replay + rhythm + shape per home card spec.
    expect(out.cards.some((c) => c.kicker === "Most replayed")).toBe(true);
    expect(out.cards.some((c) => c.kicker === "Peak day")).toBe(true);
    expect(out.cards.every((c) => !c.kicker.toLowerCase().includes("top artist"))).toBe(true);
    // Low seven-day totals prefer at most two support cards.
    expect(out.cards.length).toBeLessThanOrEqual(2);
    expect(out.yesterdaySnapshot).toBeNull();
  });

  it("Friday: weekly scope, week-in-music headline, and yesterday snapshot", () => {
    const out = buildDashboardHomeBriefing({
      nowMs: fridayNoonUtc,
      displayName: "Chris",
      summary: baseSummary({ total_scrobbles: 120 }),
      heroWindow: baseHero,
      ...utcBriefingOpts,
    });
    expect(out.scope).toBe("weekly");
    expect(out.dateHeadline).toContain("week in music");
    expect(out.dateHeadline).toContain("Friday");
    const narrativeJoin = out.narrativeParagraphs.flatMap((p) => p.map((s) => s.text)).join("");
    expect(narrativeJoin).toContain("Radiohead");
    expect(narrativeJoin).not.toMatch(/\d+\s+tracks?\s+vs\.\s*\d+/i);
    // Prior-week comparison lives in SHIFT secondary rows, not duplicated in the narrative.
    expect(narrativeJoin.toLowerCase()).not.toContain("week before");
    expect(out.secondaryInsights.some((r) => r.tag === "SHIFT")).toBe(true);
    expect(out.yesterdaySnapshot?.body).toBeTruthy();
    expect(out.yesterdaySnapshot?.body).toMatch(/Thursday/);
    expect(out.secondaryInsights.some((r) => r.tag === "A YEAR AGO")).toBe(true);
    expect(out.cards.length).toBeGreaterThanOrEqual(2);
    expect(out.cards.length).toBeLessThanOrEqual(3);
    expect(out.actions[0]?.href).toBe("/dashboard/archive?range=7d");
    expect(out.actions[0]?.label).toBe("See this week's breakdown");
  });

  it("parseDashboardHomeBriefingFromJson round-trips JSON", () => {
    const out = buildDashboardHomeBriefing({
      nowMs: thursdayNoonUtc,
      displayName: "Ada",
      summary: baseSummary(),
      heroWindow: baseHero,
      ...utcBriefingOpts,
    });
    const json = JSON.parse(JSON.stringify(out)) as unknown;
    const parsed = parseDashboardHomeBriefingFromJson(json);
    expect(parsed?.scope).toBe(out.scope);
    expect(parsed?.greetingLine1).toBe(out.greetingLine1);
  });

  it("VS-62 / VS-65: Core-plan gate shell is calendar chrome only (no stats cards; narrative in UI gate)", () => {
    const out = buildDashboardHomeAdvancedGateBriefing({
      nowMs: thursdayNoonUtc,
      displayName: "Ada",
      calendarTimeZone: "America/Los_Angeles",
    });
    expect(out.secondaryInsights).toEqual([]);
    expect(out.cards).toEqual([]);
    expect(out.actions).toEqual([]);
    expect(out.narrativeParagraphs).toEqual([]);
    expect(out.greetingLine1).toContain("Ada");
  });
});
