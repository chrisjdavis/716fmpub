import { describe, expect, it } from "vitest";
import {
  computeListeningWindowComparisons,
  LISTENING_WINDOW_COMPARISON_METRIC_FAMILY_V1,
} from "./listeningWindowComparison.js";
import type { ListeningWindowCountSlice } from "./listeningWindowComparison.js";

function slice(overrides?: Partial<ListeningWindowCountSlice>): ListeningWindowCountSlice {
  return {
    playCount: 100,
    distinctArtistCount: 20,
    distinctTrackCount: 60,
    noveltyAttributedPlayCount: 30,
    familiarityAttributedPlayCount: 70,
    ...overrides,
  };
}

describe("computeListeningWindowComparisons", () => {
  it("computes prior deltas when comparability is flagged and peer slice is present", () => {
    const r = computeListeningWindowComparisons({
      comparableToPriorWindowSameGrain: true,
      comparableToYearAgoWindowSameGrain: false,
      current: slice({ playCount: 100, distinctArtistCount: 25 }),
      priorWindow: slice({ playCount: 80, distinctArtistCount: 20 }),
      yearAgoWindow: null,
    });
    expect(r.metricFamily).toBe(LISTENING_WINDOW_COMPARISON_METRIC_FAMILY_V1);
    expect(r.versusPriorWindow).toEqual(
      expect.objectContaining({
        computed: true,
        peerPlayCount: 80,
        playCountAbsoluteDelta: 20,
        playCountRelativeDelta: 0.25,
        distinctArtistCountAbsoluteDelta: 5,
      }),
    );
    expect(r.versusYearAgoWindow).toEqual(
      expect.objectContaining({ computed: false, reason: "NOT_FLAGGED_COMPARABLE" }),
    );
  });

  it("withholds prior comparison when the flag is false even if a peer slice exists", () => {
    const r = computeListeningWindowComparisons({
      comparableToPriorWindowSameGrain: false,
      comparableToYearAgoWindowSameGrain: false,
      current: slice(),
      priorWindow: slice({ playCount: 50 }),
      yearAgoWindow: null,
    });
    expect(r.versusPriorWindow).toEqual(
      expect.objectContaining({ computed: false, reason: "NOT_FLAGGED_COMPARABLE" }),
    );
    expect(r.anomalyCandidates.volumeRatioVersusPrior).toBeNull();
  });

  it("returns MISSING_PEER_SLICE when comparable but prior is null", () => {
    const r = computeListeningWindowComparisons({
      comparableToPriorWindowSameGrain: true,
      comparableToYearAgoWindowSameGrain: true,
      current: slice(),
      priorWindow: null,
      yearAgoWindow: null,
    });
    expect(r.versusPriorWindow).toEqual(
      expect.objectContaining({ computed: false, reason: "MISSING_PEER_SLICE" }),
    );
    expect(r.versusYearAgoWindow).toEqual(
      expect.objectContaining({ computed: false, reason: "MISSING_PEER_SLICE" }),
    );
  });

  it("computes year-ago block only when flagged and a valid peer exists", () => {
    const r = computeListeningWindowComparisons({
      comparableToPriorWindowSameGrain: true,
      comparableToYearAgoWindowSameGrain: true,
      current: slice({
        playCount: 40,
        distinctArtistCount: 15,
        distinctTrackCount: 30,
        noveltyAttributedPlayCount: 8,
        familiarityAttributedPlayCount: 32,
      }),
      priorWindow: slice({
        playCount: 40,
        distinctArtistCount: 14,
        distinctTrackCount: 28,
        noveltyAttributedPlayCount: 5,
        familiarityAttributedPlayCount: 35,
      }),
      yearAgoWindow: slice({
        playCount: 10,
        distinctArtistCount: 5,
        distinctTrackCount: 8,
        noveltyAttributedPlayCount: 4,
        familiarityAttributedPlayCount: 6,
      }),
    });
    expect(r.versusYearAgoWindow).toEqual(
      expect.objectContaining({
        computed: true,
        peerPlayCount: 10,
        playCountAbsoluteDelta: 30,
        playCountRelativeDelta: 3,
      }),
    );
    expect(r.anomalyCandidates.volumeRatioVersusYearAgo).toBe(4);
  });

  it("emits null relative play delta when peer play count is zero", () => {
    const r = computeListeningWindowComparisons({
      comparableToPriorWindowSameGrain: true,
      comparableToYearAgoWindowSameGrain: false,
      current: slice({
        playCount: 10,
        distinctArtistCount: 6,
        distinctTrackCount: 9,
        noveltyAttributedPlayCount: 2,
        familiarityAttributedPlayCount: 8,
      }),
      priorWindow: slice({
        playCount: 0,
        distinctArtistCount: 0,
        distinctTrackCount: 0,
        noveltyAttributedPlayCount: 0,
        familiarityAttributedPlayCount: 0,
      }),
      yearAgoWindow: null,
    });
    expect(r.versusPriorWindow).toEqual(
      expect.objectContaining({
        computed: true,
        playCountAbsoluteDelta: 10,
        playCountRelativeDelta: null,
      }),
    );
    expect(r.anomalyCandidates.volumeRatioVersusPrior).toBeNull();
  });

  it("withholds distinct deltas when either side is unknown", () => {
    const r = computeListeningWindowComparisons({
      comparableToPriorWindowSameGrain: true,
      comparableToYearAgoWindowSameGrain: false,
      current: slice({ distinctArtistCount: null, distinctTrackCount: 12 }),
      priorWindow: slice({ distinctArtistCount: 8, distinctTrackCount: null }),
      yearAgoWindow: null,
    });
    if (!r.versusPriorWindow.computed) {
      throw new Error("expected prior computed");
    }
    expect(r.versusPriorWindow.distinctArtistCountAbsoluteDelta).toBeNull();
    expect(r.versusPriorWindow.distinctTrackCountAbsoluteDelta).toBeNull();
  });

  it("exposes novelty share when novelty and familiarity partition plays", () => {
    const r = computeListeningWindowComparisons({
      comparableToPriorWindowSameGrain: false,
      comparableToYearAgoWindowSameGrain: false,
      current: slice({
        playCount: 10,
        distinctArtistCount: 7,
        distinctTrackCount: 9,
        noveltyAttributedPlayCount: 3,
        familiarityAttributedPlayCount: 7,
      }),
      priorWindow: null,
      yearAgoWindow: null,
    });
    expect(r.noveltyFamiliarityBalanceCurrent).toEqual({
      available: true,
      noveltyAttributedPlayCount: 3,
      familiarityAttributedPlayCount: 7,
      noveltyShareOfPlays: 0.3,
    });
  });

  it("withholds novelty balance on sum mismatch", () => {
    const r = computeListeningWindowComparisons({
      comparableToPriorWindowSameGrain: false,
      comparableToYearAgoWindowSameGrain: false,
      current: slice({
        playCount: 10,
        distinctArtistCount: 5,
        distinctTrackCount: 8,
        noveltyAttributedPlayCount: 3,
        familiarityAttributedPlayCount: 3,
      }),
      priorWindow: null,
      yearAgoWindow: null,
    });
    expect(r.noveltyFamiliarityBalanceCurrent).toEqual(
      expect.objectContaining({ available: false, reason: "SUM_MISMATCH" }),
    );
  });

  it("marks novelty balance incomplete when either attribution side is null", () => {
    const r = computeListeningWindowComparisons({
      comparableToPriorWindowSameGrain: false,
      comparableToYearAgoWindowSameGrain: false,
      current: slice({ noveltyAttributedPlayCount: 5, familiarityAttributedPlayCount: null }),
      priorWindow: null,
      yearAgoWindow: null,
    });
    expect(r.noveltyFamiliarityBalanceCurrent).toEqual(
      expect.objectContaining({ available: false, reason: "INCOMPLETE_INPUT" }),
    );
  });

  it("invalidates comparisons when the current slice is malformed", () => {
    const r = computeListeningWindowComparisons({
      comparableToPriorWindowSameGrain: true,
      comparableToYearAgoWindowSameGrain: true,
      current: slice({ playCount: -1 }),
      priorWindow: slice(),
      yearAgoWindow: slice(),
    });
    expect(r.versusPriorWindow).toEqual(
      expect.objectContaining({ computed: false, reason: "INVALID_CURRENT_SLICE" }),
    );
    expect(r.versusYearAgoWindow).toEqual(
      expect.objectContaining({ computed: false, reason: "INVALID_CURRENT_SLICE" }),
    );
    expect(r.noveltyFamiliarityBalanceCurrent).toEqual(
      expect.objectContaining({ available: false, reason: "INVALID_CURRENT_SLICE" }),
    );
  });

  it("rejects an invalid peer slice even when comparability is flagged", () => {
    const r = computeListeningWindowComparisons({
      comparableToPriorWindowSameGrain: true,
      comparableToYearAgoWindowSameGrain: false,
      current: slice(),
      priorWindow: slice({ playCount: 1.5 as unknown as number }),
      yearAgoWindow: null,
    });
    expect(r.versusPriorWindow).toEqual(
      expect.objectContaining({ computed: false, reason: "INVALID_PEER_SLICE" }),
    );
  });
});
