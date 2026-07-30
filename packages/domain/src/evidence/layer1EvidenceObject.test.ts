import { describe, expect, it } from "vitest";
import {
  assertLayer1EvidenceObject,
  LAYER1_EVIDENCE_SCHEMA_VERSION,
  LAYER1_JSON_PAYLOAD_FORMAT_V1,
  parseLayer1EvidenceObject,
  type Layer1EvidenceObject,
} from "./layer1EvidenceObject.js";

const base = (): Omit<
  Layer1EvidenceObject,
  "scope" | "payload" | "insufficiency"
> => ({
  schemaVersion: LAYER1_EVIDENCE_SCHEMA_VERSION,
  signalInstanceId: "11111111-1111-4111-8111-111111111111",
  signalKind: "listen_count.total",
  signalDefinitionVersion: "1.0.0",
  emittedAtMs: 1_700_000_000_000,
  sourceObservedThroughMs: 1_699_999_000_000,
  comparability: {
    metricFamily: "listen_count_raw",
    comparableWithinUser: true,
    comparableAcrossUsers: false,
    comparableWithinArtistEntity: false,
    comparableAcrossTemporalWindowsOfSameGrain: true,
    comparableToPriorWindowSameGrain: false,
    comparableToYearAgoWindowSameGrain: false,
  },
});

const okPayload = {
  format: LAYER1_JSON_PAYLOAD_FORMAT_V1,
  data: {
    count: 42,
    nested: { ok: true },
    tags: ["a", "b"],
  },
};

describe("parseLayer1EvidenceObject", () => {
  it("accepts user-scoped evidence", () => {
    const raw = {
      ...base(),
      scope: {
        kind: "user",
        userId: "22222222-2222-4222-8222-222222222222",
      },
      payload: okPayload,
      insufficiency: {
        evaluationAsOfMs: 1_700_000_000_000,
        eligibleForDownstreamUse: true,
        codes: ["OK"],
      },
    };
    const r = parseLayer1EvidenceObject(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.scope.kind).toBe("user");
    }
  });

  it("accepts artist-scoped evidence", () => {
    const raw = {
      ...base(),
      scope: {
        kind: "artist",
        userId: "22222222-2222-4222-8222-222222222222",
        artistEntity: {
          kind: "lastfm_artist_mbid",
          mbid: "33333333-3333-4333-8333-333333333333",
        },
      },
      payload: okPayload,
      insufficiency: {
        evaluationAsOfMs: 1_700_000_000_000,
        eligibleForDownstreamUse: true,
        codes: ["OK"],
      },
    };
    const r = parseLayer1EvidenceObject(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.scope.kind).toBe("artist");
    }
  });

  it("accepts window-scoped evidence with optional artist", () => {
    const raw = {
      ...base(),
      scope: {
        kind: "window",
        userId: "22222222-2222-4222-8222-222222222222",
        temporalWindowMs: {
          startInclusiveMs: 1_699_900_000_000,
          endExclusiveMs: 1_700_000_000_000,
        },
        artistEntity: {
          kind: "lastfm_artist_url_key",
          urlKey: "radiohead",
        },
      },
      payload: okPayload,
      insufficiency: {
        evaluationAsOfMs: 1_700_000_000_000,
        eligibleForDownstreamUse: false,
        codes: ["INSUFFICIENT_SAMPLE"],
        structuredFactors: { min_required: 100, observed: 3 },
      },
      deterministicScores: {
        values: { weight_norm: 0.25 },
        unitByScoreKey: { weight_norm: "ratio" },
      },
    };
    const r = parseLayer1EvidenceObject(raw);
    expect(r.ok).toBe(true);
  });

  it("rejects temporal window with inverted bounds", () => {
    const raw = {
      ...base(),
      scope: {
        kind: "window",
        userId: "22222222-2222-4222-8222-222222222222",
        temporalWindowMs: {
          startInclusiveMs: 100,
          endExclusiveMs: 100,
        },
      },
      payload: okPayload,
      insufficiency: {
        evaluationAsOfMs: 1,
        eligibleForDownstreamUse: true,
        codes: ["OK"],
      },
    };
    expect(parseLayer1EvidenceObject(raw).ok).toBe(false);
  });

  it("rejects ineligible evidence with empty codes", () => {
    const raw = {
      ...base(),
      scope: {
        kind: "user",
        userId: "22222222-2222-4222-8222-222222222222",
      },
      payload: okPayload,
      insufficiency: {
        evaluationAsOfMs: 1,
        eligibleForDownstreamUse: false,
        codes: [],
      },
    };
    expect(parseLayer1EvidenceObject(raw).ok).toBe(false);
  });

  it("rejects sourceObservedThrough after emittedAt", () => {
    const raw = {
      ...base(),
      emittedAtMs: 100,
      sourceObservedThroughMs: 200,
      scope: {
        kind: "user",
        userId: "22222222-2222-4222-8222-222222222222",
      },
      payload: okPayload,
      insufficiency: {
        evaluationAsOfMs: 200,
        eligibleForDownstreamUse: true,
        codes: ["OK"],
      },
    };
    expect(parseLayer1EvidenceObject(raw).ok).toBe(false);
  });

  it("rejects unknown top-level keys (strict)", () => {
    const raw = {
      ...base(),
      extra: 1,
      scope: {
        kind: "user",
        userId: "22222222-2222-4222-8222-222222222222",
      },
      payload: okPayload,
      insufficiency: {
        evaluationAsOfMs: 1,
        eligibleForDownstreamUse: true,
        codes: ["OK"],
      },
    };
    expect(parseLayer1EvidenceObject(raw).ok).toBe(false);
  });

  it("defaults prior-window and year-ago comparability when omitted from comparability object", () => {
    const raw = {
      ...base(),
      comparability: {
        metricFamily: "listen_count_raw",
        comparableWithinUser: true,
        comparableAcrossUsers: false,
        comparableWithinArtistEntity: false,
        comparableAcrossTemporalWindowsOfSameGrain: true,
      },
      scope: {
        kind: "user",
        userId: "22222222-2222-4222-8222-222222222222",
      },
      payload: okPayload,
      insufficiency: {
        evaluationAsOfMs: 1,
        eligibleForDownstreamUse: true,
        codes: ["OK"],
      },
    };
    const r = parseLayer1EvidenceObject(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.comparability.comparableToPriorWindowSameGrain).toBe(false);
      expect(r.value.comparability.comparableToYearAgoWindowSameGrain).toBe(false);
    }
  });

  it("rejects prose-shaped payload format", () => {
    const raw = {
      ...base(),
      scope: {
        kind: "user",
        userId: "22222222-2222-4222-8222-222222222222",
      },
      payload: {
        format: "716fm.layer1.narrative_v1",
        data: {},
      },
      insufficiency: {
        evaluationAsOfMs: 1,
        eligibleForDownstreamUse: true,
        codes: ["OK"],
      },
    };
    expect(parseLayer1EvidenceObject(raw).ok).toBe(false);
  });
});

describe("assertLayer1EvidenceObject", () => {
  it("returns parsed value", () => {
    const v = assertLayer1EvidenceObject({
      ...base(),
      scope: {
        kind: "user",
        userId: "22222222-2222-4222-8222-222222222222",
      },
      payload: okPayload,
      insufficiency: {
        evaluationAsOfMs: 1,
        eligibleForDownstreamUse: true,
        codes: ["OK"],
      },
    });
    expect(v.signalKind).toBe("listen_count.total");
  });
});
