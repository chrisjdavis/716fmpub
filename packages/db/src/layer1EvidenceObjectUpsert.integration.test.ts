import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ARTIST_USER_RELATIONSHIP_SIGNAL_KIND,
  LAYER1_EVIDENCE_SCHEMA_VERSION,
  LAYER1_JSON_PAYLOAD_FORMAT_V1,
  buildArtistUserRelationshipLayer1Evidence,
  extractLayer1EvidencePersistenceMetadata,
  parseLayer1EvidenceObject,
  type Layer1EvidenceObject,
} from "@vs/domain";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import { upsertLayer1EvidenceObject } from "./layer1EvidenceObjectUpsert.js";

const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function baseEvidence(signalInstanceId: string): Layer1EvidenceObject {
  return {
    schemaVersion: LAYER1_EVIDENCE_SCHEMA_VERSION,
    signalInstanceId,
    signalKind: "listen_count.windowed",
    signalDefinitionVersion: "2.0.0",
    emittedAtMs: 1_700_000_000_000,
    sourceObservedThroughMs: 1_699_999_000_000,
    scope: { kind: "user", userId: USER_ID },
    payload: {
      format: LAYER1_JSON_PAYLOAD_FORMAT_V1,
      data: { n: 1, maybeNull: null },
    },
    comparability: {
      metricFamily: "listen_count_raw",
      comparableWithinUser: true,
      comparableAcrossUsers: false,
      comparableWithinArtistEntity: false,
      comparableAcrossTemporalWindowsOfSameGrain: true,
      comparableToPriorWindowSameGrain: true,
      comparableToYearAgoWindowSameGrain: false,
    },
    insufficiency: {
      evaluationAsOfMs: 1_699_000_000_000,
      eligibleForDownstreamUse: false,
      codes: ["INSUFFICIENT_SAMPLE", "STALE_SOURCE"],
      structuredFactors: { observed: 2, min_required: 50 },
    },
  };
}

describe.sequential("upsertLayer1EvidenceObject (PGlite)", () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
    await applyMigrationsToPglite(pglite);
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(async () => {
    await pglite.exec("TRUNCATE TABLE users CASCADE");
    await pglite.query(
      `insert into users (id, email, password_hash)
       values ($1::uuid, 'layer1-evidence@example.test', 'not-a-real-hash')`,
      [USER_ID],
    );
  });

  it("persists insufficiency + comparability columns aligned with body_json", async () => {
    const pool = pgliteAsPool(pglite);
    const id = randomUUID();
    const evidence = baseEvidence(id);
    const r = await upsertLayer1EvidenceObject(pool, { userId: USER_ID, evidence });
    expect(r).toEqual({ ok: true });

    const { rows } = await pglite.query<{
      body_json: unknown;
      eligible_for_downstream_use: boolean;
      insufficiency_codes: string[];
      insufficiency_evaluation_as_of_ms: string;
      insufficiency_structured_factors: unknown;
      comparability_metric_family: string;
      comparable_to_prior_window_same_grain: boolean;
      comparable_to_year_ago_window_same_grain: boolean;
    }>(
      `select
         body_json,
         eligible_for_downstream_use,
         insufficiency_codes,
         insufficiency_evaluation_as_of_ms::text,
         insufficiency_structured_factors,
         comparability_metric_family,
         comparable_to_prior_window_same_grain,
         comparable_to_year_ago_window_same_grain
       from layer1_evidence_objects
       where signal_instance_id = $1::uuid`,
      [id],
    );
    const row = rows[0];
    expect(row).toBeDefined();
    const parsed = parseLayer1EvidenceObject(row?.body_json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const meta = extractLayer1EvidencePersistenceMetadata(parsed.value);
    expect(row?.eligible_for_downstream_use).toBe(meta.eligibleForDownstreamUse);
    expect(row?.insufficiency_codes).toEqual([...meta.insufficiencyCodes]);
    expect(row?.insufficiency_evaluation_as_of_ms).toBe(
      String(meta.insufficiencyEvaluationAsOfMs),
    );
    expect(row?.insufficiency_structured_factors).toEqual(
      meta.insufficiencyStructuredFactors,
    );
    expect(row?.comparability_metric_family).toBe(meta.comparabilityMetricFamily);
    expect(row?.comparable_to_prior_window_same_grain).toBe(
      meta.comparableToPriorWindowSameGrain,
    );
    expect(row?.comparable_to_year_ago_window_same_grain).toBe(
      meta.comparableToYearAgoWindowSameGrain,
    );
    expect(parsed.value.payload.data.maybeNull).toBe(null);
  });

  it("replace-upserts the same signal_instance_id without duplicate rows", async () => {
    const pool = pgliteAsPool(pglite);
    const id = randomUUID();
    const a = baseEvidence(id);
    expect(await upsertLayer1EvidenceObject(pool, { userId: USER_ID, evidence: a })).toEqual({
      ok: true,
    });
    const b: Layer1EvidenceObject = {
      ...a,
      insufficiency: {
        evaluationAsOfMs: 1_701_000_000_000,
        eligibleForDownstreamUse: true,
        codes: ["OK"],
      },
      comparability: {
        ...a.comparability,
        comparableToPriorWindowSameGrain: false,
        comparableToYearAgoWindowSameGrain: true,
      },
    };
    expect(await upsertLayer1EvidenceObject(pool, { userId: USER_ID, evidence: b })).toEqual({
      ok: true,
    });
    const { rows } = await pglite.query<{ c: string }>(
      `select count(*)::text as c from layer1_evidence_objects where signal_instance_id = $1::uuid`,
      [id],
    );
    expect(rows[0]?.c).toBe("1");
    const { rows: r2 } = await pglite.query<{
      eligible_for_downstream_use: boolean;
      comparable_to_year_ago_window_same_grain: boolean;
    }>(
      `select eligible_for_downstream_use, comparable_to_year_ago_window_same_grain
       from layer1_evidence_objects where signal_instance_id = $1::uuid`,
      [id],
    );
    expect(r2[0]?.eligible_for_downstream_use).toBe(true);
    expect(r2[0]?.comparable_to_year_ago_window_same_grain).toBe(true);
  });

  it("persists artist-scoped VS-48 artist.user_relationship.v1 evidence", async () => {
    const pool = pgliteAsPool(pglite);
    const id = randomUUID();
    const DAY = 86_400_000;
    const WS = 1_700_000_000_000;
    const evidence = buildArtistUserRelationshipLayer1Evidence({
      signalInstanceId: id,
      userId: USER_ID,
      artistEntity: {
        kind: "lastfm_artist_mbid",
        mbid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      emittedAtMs: WS + 200 * DAY,
      signals: {
        temporalWindowMs: { startInclusiveMs: WS, endExclusiveMs: WS + 90 * DAY },
        windowPlays: [
          { playedAtMs: WS, trackId: "a" },
          { playedAtMs: WS + DAY, trackId: "a" },
          { playedAtMs: WS + 2 * DAY, trackId: "b" },
        ],
        lifetimeFirstListenAtMs: WS - 10 * DAY,
        lastListenBeforeWindowAtMs: WS - 60 * DAY,
        lifetimeLastListenAtMs: WS + 2 * DAY,
        lifetimePlayCount: 50,
        catalogObservedThroughMs: WS + 90 * DAY + DAY,
        evaluationAsOfMs: WS + 100 * DAY,
      },
    });
    expect(await upsertLayer1EvidenceObject(pool, { userId: USER_ID, evidence })).toEqual({
      ok: true,
    });
    const { rows } = await pglite.query<{ body_json: unknown; artist_mbid: string | null }>(
      `select body_json, artist_mbid::text
         from layer1_evidence_objects
        where signal_instance_id = $1::uuid`,
      [id],
    );
    expect(rows[0]?.artist_mbid).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const parsed = parseLayer1EvidenceObject(rows[0]?.body_json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.signalKind).toBe(ARTIST_USER_RELATIONSHIP_SIGNAL_KIND);
      expect(parsed.value.scope.kind).toBe("artist");
    }
  });

  it("returns user_scope_mismatch when scope user disagrees", async () => {
    const pool = pgliteAsPool(pglite);
    const evidence = baseEvidence(randomUUID());
    const r = await upsertLayer1EvidenceObject(pool, {
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      evidence,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("user_scope_mismatch");
    }
  });
});
