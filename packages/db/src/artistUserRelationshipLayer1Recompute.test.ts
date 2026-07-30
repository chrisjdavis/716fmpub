import { describe, expect, it } from "vitest";
import {
  summarizeArtistOutcomes,
  type ArtistUserRelationshipLayer1ArtistOutcome,
} from "./artistUserRelationshipLayer1Recompute.js";

describe("summarizeArtistOutcomes", () => {
  it("returns zeros for an empty outcome list", () => {
    expect(summarizeArtistOutcomes([])).toEqual({
      success: 0,
      skip: 0,
      insufficiency: 0,
      failure: 0,
    });
  });

  it("counts skips, eligible materializations, ineligible materializations as insufficiency, and upsert failures", () => {
    const outcomes: ArtistUserRelationshipLayer1ArtistOutcome[] = [
      { kind: "skip", reason: "no_mbid" },
      { kind: "skip", reason: "no_window_plays" },
      { kind: "skip", reason: "window_plays_exceed_processing_cap" },
      {
        kind: "materialized",
        signalInstanceId: "a",
        eligibleForDownstreamUse: true,
        insufficiencyCodesJoined: "OK",
      },
      {
        kind: "materialized",
        signalInstanceId: "b",
        eligibleForDownstreamUse: false,
        insufficiencyCodesJoined: "INSUFFICIENT_SAMPLE,STALE_SOURCE",
      },
      {
        kind: "materialized",
        signalInstanceId: "c",
        eligibleForDownstreamUse: false,
        insufficiencyCodesJoined: "MISSING_SOURCE",
      },
      { kind: "upsert_failed", signalInstanceId: "d", detail: "constraint" },
    ];
    expect(summarizeArtistOutcomes(outcomes)).toEqual({
      success: 1,
      skip: 3,
      insufficiency: 2,
      failure: 1,
    });
  });
});
