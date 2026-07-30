import { describe, expect, it } from "vitest";
import {
  computeListeningTemporalSignals,
  gregorianOrdinalDayNumber,
  postgresDowSunday0FromGregorianYmd,
} from "./listeningTemporalSignals.js";

describe("postgresDowSunday0FromGregorianYmd", () => {
  it("matches PostgreSQL Sunday=0 for known civil dates", () => {
    expect(postgresDowSunday0FromGregorianYmd(2026, 1, 4)).toBe(0);
    expect(postgresDowSunday0FromGregorianYmd(2026, 1, 6)).toBe(2);
  });
});

describe("gregorianOrdinalDayNumber", () => {
  it("treats consecutive civil dates as +1 ordinal", () => {
    const a = gregorianOrdinalDayNumber(2024, 7, 14);
    const b = gregorianOrdinalDayNumber(2024, 7, 15);
    expect(b - a).toBe(1);
  });

  it("crosses month boundaries", () => {
    const a = gregorianOrdinalDayNumber(2024, 6, 30);
    const b = gregorianOrdinalDayNumber(2024, 7, 1);
    expect(b - a).toBe(1);
  });
});

describe("computeListeningTemporalSignals", () => {
  it("returns empty-shaped result for no listens", () => {
    const r = computeListeningTemporalSignals({
      playedAtMs: [],
      statsTimezoneIana: "America/New_York",
    });
    expect(r.total_play_count).toBe(0);
    expect(r.first_listen_at_ms).toBeNull();
    expect(r.last_listen_at_ms).toBeNull();
    expect(r.active_local_day_count).toBe(0);
    expect(r.mean_plays_per_active_local_day).toBeNull();
    expect(r.streak_windows).toEqual([]);
    expect(r.burst_windows).toEqual([]);
    expect(r.local_hour_distribution?.every((x) => x === 0)).toBe(true);
    expect(r.burst_max_inter_listen_gap_ms_applied).toBe(90_000);
    expect(r.burst_min_plays_applied).toBe(4);
    expect(r.weekday_weekend_available).toBe(true);
    expect(r.local_hour_distribution_available).toBe(true);
    expect(r.streak_windows_available).toBe(true);
  });

  it("ignores non-finite timestamps", () => {
    const r = computeListeningTemporalSignals({
      playedAtMs: [NaN, Number.POSITIVE_INFINITY, Date.UTC(2026, 0, 1, 12, 0, 0)],
      statsTimezoneIana: "UTC",
    });
    expect(r.total_play_count).toBe(1);
  });

  it("coalesces invalid timezone to UTC on resolved_stats_timezone_iana", () => {
    const r = computeListeningTemporalSignals({
      playedAtMs: [0],
      statsTimezoneIana: "Not/A_Real_Zone",
    });
    expect(r.resolved_stats_timezone_iana).toBe("UTC");
  });

  it("sorts unsorted input deterministically", () => {
    const a = Date.UTC(2026, 2, 10, 8, 0, 0);
    const b = Date.UTC(2026, 2, 5, 8, 0, 0);
    const c = Date.UTC(2026, 2, 7, 8, 0, 0);
    const r = computeListeningTemporalSignals({
      playedAtMs: [a, b, c],
      statsTimezoneIana: "UTC",
    });
    expect(r.first_listen_at_ms).toBe(b);
    expect(r.last_listen_at_ms).toBe(a);
  });

  it("counts three consecutive UTC calendar days as one streak window", () => {
    const d0 = Date.UTC(2026, 4, 1, 10, 0, 0);
    const d1 = Date.UTC(2026, 4, 2, 10, 0, 0);
    const d2 = Date.UTC(2026, 4, 3, 10, 0, 0);
    const r = computeListeningTemporalSignals({
      playedAtMs: [d0, d2, d1],
      statsTimezoneIana: "UTC",
    });
    expect(r.active_local_day_count).toBe(3);
    expect(r.streak_windows).toHaveLength(1);
    expect(r.streak_windows[0]?.length_days).toBe(3);
    expect(r.longest_streak_length_days).toBe(3);
  });

  it("splits streaks when a local day is missing", () => {
    const d0 = Date.UTC(2026, 4, 1, 10, 0, 0);
    const d1 = Date.UTC(2026, 4, 2, 10, 0, 0);
    const gap = Date.UTC(2026, 4, 4, 10, 0, 0);
    const r = computeListeningTemporalSignals({
      playedAtMs: [d0, d1, gap],
      statsTimezoneIana: "UTC",
    });
    expect(r.streak_windows).toHaveLength(2);
    expect(r.streak_windows[0]?.length_days).toBe(2);
    expect(r.streak_windows[1]?.length_days).toBe(1);
  });

  it("detects burst windows with default thresholds", () => {
    const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);
    const plays = [t0, t0 + 30_000, t0 + 60_000, t0 + 120_000];
    const r = computeListeningTemporalSignals({
      playedAtMs: plays,
      statsTimezoneIana: "UTC",
    });
    expect(r.burst_windows).toHaveLength(1);
    expect(r.burst_windows[0]?.play_count).toBe(4);
    expect(r.burst_windows[0]?.start_played_at_ms).toBe(t0);
    expect(r.burst_windows[0]?.end_played_at_ms).toBe(t0 + 120_000);
  });

  it("does not merge bursts when inter-listen gap exceeds max", () => {
    const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);
    const cluster = [t0, t0 + 30_000, t0 + 60_000, t0 + 90_000];
    const tGap = t0 + 90_000 + 120_000;
    const cluster2 = [tGap, tGap + 30_000, tGap + 60_000, tGap + 90_000];
    const r = computeListeningTemporalSignals({
      playedAtMs: [...cluster, ...cluster2],
      statsTimezoneIana: "UTC",
      burstMaxInterListenGapMs: 90_000,
      burstMinPlays: 4,
    });
    expect(r.burst_windows).toHaveLength(2);
  });

  it("classifies Sunday plays as weekend under PG dow semantics", () => {
    const sundayUtc = Date.UTC(2026, 0, 4, 15, 0, 0);
    const r = computeListeningTemporalSignals({
      playedAtMs: [sundayUtc, sundayUtc + 1000],
      statsTimezoneIana: "UTC",
    });
    expect(r.weekday_weekend_available).toBe(true);
    expect(r.weekend_play_count).toBe(2);
    expect(r.weekday_play_count).toBe(0);
    expect((r.weekday_play_count ?? 0) + (r.weekend_play_count ?? 0)).toBe(r.total_play_count);
  });

  it("classifies Tuesday plays as weekday", () => {
    const tueUtc = Date.UTC(2026, 0, 6, 15, 0, 0);
    const r = computeListeningTemporalSignals({
      playedAtMs: [tueUtc],
      statsTimezoneIana: "UTC",
    });
    expect(r.weekday_weekend_available).toBe(true);
    expect(r.weekday_play_count).toBe(1);
    expect(r.weekend_play_count).toBe(0);
  });

  /**
   * America/Los_Angeles is UTC−7 on 2024-07-15.
   * 2024-07-15T06:59:00.000Z → 2024-07-14 23:59 PDT
   * 2024-07-15T07:01:00.000Z → 2024-07-15 00:01 PDT
   */
  it("splits active local days across a Los Angeles civil midnight", () => {
    const before = Date.parse("2024-07-15T06:59:00.000Z");
    const after = Date.parse("2024-07-15T07:01:00.000Z");
    const r = computeListeningTemporalSignals({
      playedAtMs: [before, after],
      statsTimezoneIana: "America/Los_Angeles",
    });
    expect(r.resolved_stats_timezone_iana).toBe("America/Los_Angeles");
    expect(r.active_local_day_count).toBe(2);
    expect(r.streak_windows).toHaveLength(1);
    expect(r.streak_windows[0]?.length_days).toBe(2);
    expect(r.local_hour_distribution_available).toBe(true);
    const dist = [...(r.local_hour_distribution ?? [])];
    expect(dist.reduce((a, b) => a + b, 0)).toBe(2);
  });

  /**
   * Same two instants in UTC are the same civil UTC day → one active day.
   */
  it("contrasts UTC zone: same instants stay on one UTC calendar day", () => {
    const before = Date.parse("2024-07-15T06:59:00.000Z");
    const after = Date.parse("2024-07-15T07:01:00.000Z");
    const r = computeListeningTemporalSignals({
      playedAtMs: [before, after],
      statsTimezoneIana: "UTC",
    });
    expect(r.active_local_day_count).toBe(1);
    expect(r.streak_windows[0]?.length_days).toBe(1);
  });

  it("places local hour counts in the resolved zone", () => {
    const noonUtc = Date.UTC(2026, 0, 15, 12, 0, 0);
    const r = computeListeningTemporalSignals({
      playedAtMs: [noonUtc],
      statsTimezoneIana: "America/New_York",
    });
    expect(r.local_hour_distribution_available).toBe(true);
    const h = (r.local_hour_distribution ?? []).findIndex((c) => c === 1);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(23);
  });

  it("echoes applied burst parameters on the result object", () => {
    const r = computeListeningTemporalSignals({
      playedAtMs: [0],
      statsTimezoneIana: "UTC",
      burstMaxInterListenGapMs: 12_000,
      burstMinPlays: 3,
    });
    expect(r.burst_max_inter_listen_gap_ms_applied).toBe(12_000);
    expect(r.burst_min_plays_applied).toBe(3);
  });
});
