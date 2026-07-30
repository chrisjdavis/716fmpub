import { describe, expect, it } from "vitest";
import {
  consistencyScoreFromWeekdayCounts,
  parseUserWindowSignalsSnapshotBodyV1,
} from "./userWindowSignalsRecompute.js";

describe("consistencyScoreFromWeekdayCounts", () => {
  it("returns null for wrong length", () => {
    expect(consistencyScoreFromWeekdayCounts([1, 2])).toBeNull();
  });

  it("returns null when no plays", () => {
    expect(consistencyScoreFromWeekdayCounts([0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });

  it("scores one hot day lower than a spread week", () => {
    const clustered = consistencyScoreFromWeekdayCounts([10, 0, 0, 0, 0, 0, 0]);
    const spread = consistencyScoreFromWeekdayCounts([2, 2, 2, 1, 1, 1, 1]);
    expect(clustered).not.toBeNull();
    expect(spread).not.toBeNull();
    expect(spread!).toBeGreaterThan(clustered!);
  });
});

describe("parseUserWindowSignalsSnapshotBodyV1", () => {
  it("returns null for non-objects", () => {
    expect(parseUserWindowSignalsSnapshotBodyV1(null)).toBeNull();
    expect(parseUserWindowSignalsSnapshotBodyV1("x")).toBeNull();
    expect(parseUserWindowSignalsSnapshotBodyV1(1)).toBeNull();
  });

  it("returns null when schema_version mismatches", () => {
    expect(
      parseUserWindowSignalsSnapshotBodyV1({
        schema_version: 99,
        as_of: "2026-01-01T00:00:00.000Z",
        stats_timezone: "UTC",
        ranges: {},
      }),
    ).toBeNull();
  });

  it("returns null when a required range key is missing", () => {
    expect(
      parseUserWindowSignalsSnapshotBodyV1({
        schema_version: 1,
        as_of: "2026-01-01T00:00:00.000Z",
        stats_timezone: "UTC",
        ranges: { "7d": {}, "30d": {}, "90d": {} },
      }),
    ).toBeNull();
  });

  it("parses a minimal valid v1 body", () => {
    const slot = {
      window_start_iso: "a",
      window_end_iso: "b",
      play_count: 1,
      distinct_artists: 1,
      distinct_tracks: 1,
      top_artist_id: null,
      top_artist_plays: null,
      previous_play_count: null,
      delta_absolute: null,
      delta_percent: null,
      previous_distinct_artists: null,
      repeat_ratio: null,
      discovery_ratio: null,
      peak_weekday: null,
      weekday_distribution: [0, 0, 0, 0, 0, 0, 0],
      peak_daypart: null,
      consistency_score: null,
      new_artists: [],
      returning_artists: [],
      spiking_artists: [],
    };
    const raw = {
      schema_version: 1,
      as_of: "2026-04-14T12:00:00.000Z",
      stats_timezone: "UTC",
      ranges: {
        "7d": slot,
        "30d": slot,
        "90d": slot,
        all: slot,
      },
    };
    const parsed = parseUserWindowSignalsSnapshotBodyV1(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.ranges["7d"].play_count).toBe(1);
  });
});
