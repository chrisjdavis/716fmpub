import { describe, expect, it } from "vitest";
import { parseLayer1EvidenceObject } from "./evidence/layer1EvidenceObject.js";
import {
  ARTIST_USER_RELATIONSHIP_DORMANT_GAP_MS,
  ARTIST_USER_RELATIONSHIP_METRIC_FAMILY_V1,
  ARTIST_USER_RELATIONSHIP_SIGNAL_KIND,
  buildArtistUserRelationshipLayer1Evidence,
  computeArtistUserRelationshipSignals,
  deterministicArtistUserRelationshipSignalInstanceId,
} from "./artistUserRelationshipSignals.js";

const USER = "22222222-2222-4222-8222-222222222222";
const MBID = "33333333-3333-4333-8333-333333333333";
const ARTIST = { kind: "lastfm_artist_mbid" as const, mbid: MBID };

const DAY = 86_400_000;
const T_WINDOW_START = 1_700_000_000_000;
const WINDOW = {
  startInclusiveMs: T_WINDOW_START,
  endExclusiveMs: T_WINDOW_START + 90 * DAY,
};

function baseCatalogThroughWindowEnd() {
  return WINDOW.endExclusiveMs + DAY;
}

describe("computeArtistUserRelationshipSignals", () => {
  it("rich history: dormant return, depth, repeat intensity, durability span, not first touch in window", () => {
    const lastBefore = T_WINDOW_START - 50 * DAY;
    const firstLife = T_WINDOW_START - 400 * DAY;
    const lastLife = T_WINDOW_START + 20 * DAY;
    const plays = [
      ...Array.from({ length: 10 }, (_, i) => ({
        playedAtMs: T_WINDOW_START + i * DAY,
        trackId: `t${i % 5}`,
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        playedAtMs: T_WINDOW_START + (10 + i) * DAY,
        trackId: `t${i % 5}`,
      })),
    ];
    const r = computeArtistUserRelationshipSignals({
      temporalWindowMs: WINDOW,
      windowPlays: plays,
      lifetimeFirstListenAtMs: firstLife,
      lastListenBeforeWindowAtMs: lastBefore,
      lifetimeLastListenAtMs: lastLife,
      lifetimePlayCount: 220,
      catalogObservedThroughMs: baseCatalogThroughWindowEnd(),
      evaluationAsOfMs: T_WINDOW_START + 100 * DAY,
    });
    expect(r.metricFamily).toBe(ARTIST_USER_RELATIONSHIP_METRIC_FAMILY_V1);
    expect(r.playCountInWindow).toBe(20);
    expect(r.distinctTrackCountInWindow).toBe(5);
    expect(r.trackExplorationRatio).toBeCloseTo(5 / 20);
    expect(r.repeatListenIntensity).toBe(1);
    expect(r.dormantReturnEvent).toBe(true);
    expect(r.firstUserListenToArtistInWindow).toBe(false);
    expect(r.relationshipSpanMs).toBe(lastLife - firstLife);
    expect(r.windowShareOfLifetimePlays).toBeCloseTo(20 / 220);
    expect(r.insufficiency.eligibleForDownstreamUse).toBe(true);
    expect(r.insufficiency.codes).toEqual(["OK"]);
    expect(r.engagementDepthMeanPlaysPerDistinctTrack).toBeCloseTo(4);
  });

  it("sparse user: ineligible with INSUFFICIENT_SAMPLE only when catalog is fresh", () => {
    const r = computeArtistUserRelationshipSignals({
      temporalWindowMs: WINDOW,
      windowPlays: [{ playedAtMs: T_WINDOW_START + DAY, trackId: "a" }],
      lifetimeFirstListenAtMs: T_WINDOW_START + DAY,
      lastListenBeforeWindowAtMs: null,
      lifetimeLastListenAtMs: T_WINDOW_START + DAY,
      lifetimePlayCount: 1,
      catalogObservedThroughMs: baseCatalogThroughWindowEnd(),
      evaluationAsOfMs: T_WINDOW_START + 100 * DAY,
    });
    expect(r.playCountInWindow).toBe(1);
    expect(r.sparseRelationshipInWindow).toBe(true);
    expect(r.insufficiency.eligibleForDownstreamUse).toBe(false);
    expect(r.insufficiency.codes).toEqual(expect.arrayContaining(["INSUFFICIENT_SAMPLE"]));
    expect(r.insufficiency.codes).not.toContain("MISSING_SOURCE");
    expect(r.trackExplorationRatio).toBe(1);
    expect(r.repeatListenIntensity).toBe(0);
  });

  it("exploratory user: high exploration ratio, zero repeat intensity", () => {
    const plays = Array.from({ length: 12 }, (_, i) => ({
      playedAtMs: T_WINDOW_START + i * 60_000,
      trackId: `track-${i}`,
    }));
    const r = computeArtistUserRelationshipSignals({
      temporalWindowMs: WINDOW,
      windowPlays: plays,
      lifetimeFirstListenAtMs: T_WINDOW_START,
      lastListenBeforeWindowAtMs: null,
      lifetimeLastListenAtMs: T_WINDOW_START + 11 * 60_000,
      lifetimePlayCount: 12,
      catalogObservedThroughMs: baseCatalogThroughWindowEnd(),
      evaluationAsOfMs: T_WINDOW_START + 100 * DAY,
    });
    expect(r.distinctTrackCountInWindow).toBe(12);
    expect(r.trackExplorationRatio).toBe(1);
    expect(r.repeatListenIntensity).toBe(0);
    expect(r.insufficiency.eligibleForDownstreamUse).toBe(true);
  });

  it("first user listen to artist when first lifetime listen lands inside the window", () => {
    const firstInWindow = T_WINDOW_START + 2 * DAY;
    const r = computeArtistUserRelationshipSignals({
      temporalWindowMs: WINDOW,
      windowPlays: [
        { playedAtMs: firstInWindow, trackId: "x" },
        { playedAtMs: firstInWindow + 60_000, trackId: "x" },
        { playedAtMs: firstInWindow + 120_000, trackId: "y" },
      ],
      lifetimeFirstListenAtMs: firstInWindow,
      lastListenBeforeWindowAtMs: null,
      lifetimeLastListenAtMs: firstInWindow + 120_000,
      lifetimePlayCount: 3,
      catalogObservedThroughMs: baseCatalogThroughWindowEnd(),
      evaluationAsOfMs: T_WINDOW_START + 100 * DAY,
    });
    expect(r.firstUserListenToArtistInWindow).toBe(true);
    expect(r.dormantReturnEvent).toBe(false);
  });

  it("no dormant return when gap before window is shorter than threshold", () => {
    const lastBefore = T_WINDOW_START - 10 * DAY;
    const r = computeArtistUserRelationshipSignals({
      temporalWindowMs: WINDOW,
      windowPlays: [{ playedAtMs: T_WINDOW_START + DAY, trackId: "a" }],
      lifetimeFirstListenAtMs: T_WINDOW_START - 200 * DAY,
      lastListenBeforeWindowAtMs: lastBefore,
      lifetimeLastListenAtMs: T_WINDOW_START + DAY,
      lifetimePlayCount: 5,
      catalogObservedThroughMs: baseCatalogThroughWindowEnd(),
      evaluationAsOfMs: T_WINDOW_START + 100 * DAY,
    });
    expect(r.dormantReturnEvent).toBe(false);
    expect(lastBefore).toBeGreaterThan(T_WINDOW_START - ARTIST_USER_RELATIONSHIP_DORMANT_GAP_MS);
  });

  it("marks STALE_SOURCE when catalog does not reach window end", () => {
    const r = computeArtistUserRelationshipSignals({
      temporalWindowMs: WINDOW,
      windowPlays: [
        { playedAtMs: T_WINDOW_START, trackId: "a" },
        { playedAtMs: T_WINDOW_START + DAY, trackId: "a" },
        { playedAtMs: T_WINDOW_START + 2 * DAY, trackId: "a" },
      ],
      lifetimeFirstListenAtMs: T_WINDOW_START,
      lastListenBeforeWindowAtMs: null,
      lifetimeLastListenAtMs: T_WINDOW_START + 2 * DAY,
      lifetimePlayCount: 3,
      catalogObservedThroughMs: WINDOW.startInclusiveMs + DAY,
      evaluationAsOfMs: T_WINDOW_START + 100 * DAY,
    });
    expect(r.catalogStaleForWindow).toBe(true);
    expect(r.insufficiency.codes).toEqual(expect.arrayContaining(["STALE_SOURCE"]));
  });

  it("marks MISSING_SOURCE when catalog cursor is absent", () => {
    const r = computeArtistUserRelationshipSignals({
      temporalWindowMs: WINDOW,
      windowPlays: [
        { playedAtMs: T_WINDOW_START, trackId: "a" },
        { playedAtMs: T_WINDOW_START + DAY, trackId: "a" },
        { playedAtMs: T_WINDOW_START + 2 * DAY, trackId: "a" },
      ],
      lifetimeFirstListenAtMs: T_WINDOW_START,
      lastListenBeforeWindowAtMs: null,
      lifetimeLastListenAtMs: T_WINDOW_START + 2 * DAY,
      lifetimePlayCount: 3,
      catalogObservedThroughMs: null,
      evaluationAsOfMs: T_WINDOW_START + 100 * DAY,
    });
    expect(r.catalogCursorMissing).toBe(true);
    expect(r.insufficiency.codes).toEqual(expect.arrayContaining(["MISSING_SOURCE"]));
  });

  it("invalid window yields UNKNOWN_ELIGIBILITY", () => {
    const r = computeArtistUserRelationshipSignals({
      temporalWindowMs: {
        startInclusiveMs: WINDOW.endExclusiveMs,
        endExclusiveMs: WINDOW.startInclusiveMs,
      },
      windowPlays: [],
      lifetimeFirstListenAtMs: null,
      lastListenBeforeWindowAtMs: null,
      lifetimeLastListenAtMs: null,
      lifetimePlayCount: null,
      catalogObservedThroughMs: null,
      evaluationAsOfMs: 1,
    });
    expect(r.insufficiency.codes).toEqual(["UNKNOWN_ELIGIBILITY"]);
  });
});

describe("deterministicArtistUserRelationshipSignalInstanceId", () => {
  it("is stable for the same inputs and matches UUID shape", () => {
    const a = deterministicArtistUserRelationshipSignalInstanceId({
      userId: USER,
      artistEntity: ARTIST,
      windowStartInclusiveMs: WINDOW.startInclusiveMs,
      windowEndExclusiveMs: WINDOW.endExclusiveMs,
    });
    const b = deterministicArtistUserRelationshipSignalInstanceId({
      userId: USER,
      artistEntity: ARTIST,
      windowStartInclusiveMs: WINDOW.startInclusiveMs,
      windowEndExclusiveMs: WINDOW.endExclusiveMs,
    });
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe("buildArtistUserRelationshipLayer1Evidence", () => {
  it("produces a parse-valid Layer1EvidenceObject with artist scope", () => {
    const evidence = buildArtistUserRelationshipLayer1Evidence({
      signalInstanceId: "11111111-1111-4111-8111-111111111111",
      userId: USER,
      artistEntity: ARTIST,
      emittedAtMs: T_WINDOW_START + 200 * DAY,
      signals: {
        temporalWindowMs: WINDOW,
        windowPlays: [
          { playedAtMs: T_WINDOW_START, trackId: "a" },
          { playedAtMs: T_WINDOW_START + DAY, trackId: "a" },
          { playedAtMs: T_WINDOW_START + 2 * DAY, trackId: "b" },
        ],
        lifetimeFirstListenAtMs: T_WINDOW_START - 10 * DAY,
        lastListenBeforeWindowAtMs: T_WINDOW_START - 60 * DAY,
        lifetimeLastListenAtMs: T_WINDOW_START + 2 * DAY,
        lifetimePlayCount: 50,
        catalogObservedThroughMs: baseCatalogThroughWindowEnd(),
        evaluationAsOfMs: T_WINDOW_START + 100 * DAY,
      },
    });
    expect(evidence.signalKind).toBe(ARTIST_USER_RELATIONSHIP_SIGNAL_KIND);
    expect(evidence.scope).toEqual({
      kind: "artist",
      userId: USER,
      artistEntity: ARTIST,
    });
    expect(evidence.sourceObservedThroughMs).toBeLessThanOrEqual(evidence.emittedAtMs);
    const parsed = parseLayer1EvidenceObject(evidence);
    expect(parsed.ok).toBe(true);
  });
});
