import { describe, expect, it } from "vitest";
import {
  buildLayer1AnalyticsSnapshotKind,
  LAYER1_ANALYTICS_ROW_RECOMPUTE_SEMANTICS,
  LAYER1_ANALYTICS_SNAPSHOT_KIND_SCHEME_VERSION,
  layer1EvidenceScopeStableJson,
} from "./layer1SignalPersistence.js";
import type { Layer1EvidenceScope } from "./layer1EvidenceObject.js";

const userScope = (userId: string): Layer1EvidenceScope => ({
  kind: "user",
  userId,
});

describe("layer1EvidenceScopeStableJson", () => {
  it("is deterministic for the same scope value", () => {
    const s: Layer1EvidenceScope = {
      kind: "window",
      userId: "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee",
      temporalWindowMs: { startInclusiveMs: 100, endExclusiveMs: 200 },
      artistEntity: { kind: "lastfm_artist_mbid", mbid: "11111111-1111-4111-8111-111111111111" },
    };
    expect(layer1EvidenceScopeStableJson(s)).toBe(layer1EvidenceScopeStableJson(s));
  });

  it("differs when window bounds differ", () => {
    const u = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";
    const a: Layer1EvidenceScope = {
      kind: "window",
      userId: u,
      temporalWindowMs: { startInclusiveMs: 0, endExclusiveMs: 1 },
    };
    const b: Layer1EvidenceScope = {
      kind: "window",
      userId: u,
      temporalWindowMs: { startInclusiveMs: 0, endExclusiveMs: 2 },
    };
    expect(layer1EvidenceScopeStableJson(a)).not.toBe(layer1EvidenceScopeStableJson(b));
  });
});

describe("buildLayer1AnalyticsSnapshotKind", () => {
  it("returns the same kind for identical rerun inputs (idempotency key)", () => {
    const scope = userScope("aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee");
    const a = buildLayer1AnalyticsSnapshotKind({ signalKind: "listen_count.total", scope });
    const b = buildLayer1AnalyticsSnapshotKind({ signalKind: "listen_count.total", scope });
    expect(a).toEqual(b);
    expect(a.ok && b.ok && a.kind).toBe(b.ok ? b.kind : "");
  });

  it("rejects invalid signal kinds (prevents uncontrolled kind strings)", () => {
    const r = buildLayer1AnalyticsSnapshotKind({
      signalKind: "Listen_Count", // uppercase: invalid slug
      scope: userScope("aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("invalid_signal_kind");
    }
  });

  it("rejects invalid temporal windows", () => {
    const scope: Layer1EvidenceScope = {
      kind: "window",
      userId: "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee",
      temporalWindowMs: { startInclusiveMs: 10, endExclusiveMs: 10 },
    };
    const r = buildLayer1AnalyticsSnapshotKind({ signalKind: "listen_count.total", scope });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("invalid_scope");
    }
  });

  it("encodes scheme version so kind grammar can evolve without silent collisions", () => {
    const scope = userScope("aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee");
    const r = buildLayer1AnalyticsSnapshotKind({ signalKind: "listen_count.total", scope });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toContain(`:v${LAYER1_ANALYTICS_SNAPSHOT_KIND_SCHEME_VERSION}:`);
    }
  });
});

describe("LAYER1_ANALYTICS_ROW_RECOMPUTE_SEMANTICS", () => {
  it("documents replace-upsert + read-time stale handling (not soft-delete rows)", () => {
    expect(LAYER1_ANALYTICS_ROW_RECOMPUTE_SEMANTICS.writeIntent).toBe("replace");
    expect(LAYER1_ANALYTICS_ROW_RECOMPUTE_SEMANTICS.replaceUpsertSqlRef).toContain(
      "analyticsSnapshotsUpsert",
    );
    expect(LAYER1_ANALYTICS_ROW_RECOMPUTE_SEMANTICS.duplicateRowsPerKey).toBe(
      "prevented_by_unique_constraint",
    );
    expect(LAYER1_ANALYTICS_ROW_RECOMPUTE_SEMANTICS.staleHandling).toBe(
      "read_time_probe_against_canonical_sources",
    );
    expect(LAYER1_ANALYTICS_ROW_RECOMPUTE_SEMANTICS.priorBodyRetentionInDb).toBe("none");
  });
});
