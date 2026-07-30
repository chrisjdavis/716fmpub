import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  LAYER1_EVIDENCE_SCHEMA_VERSION,
  LAYER1_JSON_PAYLOAD_FORMAT_V1,
  buildLayer1AnalyticsSnapshotKind,
  type Layer1EvidenceObject,
} from "@vs/domain";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import { upsertLayer1EvidenceAnalyticsSnapshot } from "./layer1EvidenceAnalyticsSnapshot.js";

const USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function fixtureEvidence(signalInstanceId: string): Layer1EvidenceObject {
  return {
    schemaVersion: LAYER1_EVIDENCE_SCHEMA_VERSION,
    signalInstanceId,
    signalKind: "listen_count.total",
    signalDefinitionVersion: "1.0.0",
    emittedAtMs: 1_700_000_000_000,
    sourceObservedThroughMs: 1_699_999_000_000,
    scope: { kind: "user", userId: USER_ID },
    payload: {
      format: LAYER1_JSON_PAYLOAD_FORMAT_V1,
      data: { n: 1 },
    },
    comparability: {
      metricFamily: "listen_count_raw",
      comparableWithinUser: true,
      comparableAcrossUsers: false,
      comparableWithinArtistEntity: false,
      comparableAcrossTemporalWindowsOfSameGrain: true,
      comparableToPriorWindowSameGrain: false,
      comparableToYearAgoWindowSameGrain: false,
    },
    insufficiency: {
      evaluationAsOfMs: 1_700_000_000_000,
      eligibleForDownstreamUse: true,
      codes: ["OK"],
    },
  };
}

describe.sequential("upsertLayer1EvidenceAnalyticsSnapshot (PGlite)", () => {
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
       values ($1::uuid, 'layer1-snapshot@example.test', 'not-a-real-hash')`,
      [USER_ID],
    );
  });

  it("uses buildLayer1AnalyticsSnapshotKind for kind and replaces on rerun (no duplicate rows)", async () => {
    const pool = pgliteAsPool(pglite);
    const kind = buildLayer1AnalyticsSnapshotKind({
      signalKind: "listen_count.total",
      scope: { kind: "user", userId: USER_ID },
    });
    expect(kind.ok).toBe(true);
    if (!kind.ok) {
      throw new Error("expected kind");
    }

    const a = await upsertLayer1EvidenceAnalyticsSnapshot(pool, {
      userId: USER_ID,
      evidence: fixtureEvidence(randomUUID()),
    });
    expect(a).toEqual({ ok: true });

    const b = await upsertLayer1EvidenceAnalyticsSnapshot(pool, {
      userId: USER_ID,
      evidence: fixtureEvidence(randomUUID()),
    });
    expect(b).toEqual({ ok: true });

    const { rows } = await pglite.query<{ c: string }>(
      `select count(*)::text as c from analytics_snapshots
       where user_id = $1::uuid and kind = $2`,
      [USER_ID, kind.kind],
    );
    expect(rows[0]?.c).toBe("1");
  });

  it("rejects when scope user id disagrees with input user id", async () => {
    const pool = pgliteAsPool(pglite);
    const evidence = fixtureEvidence(randomUUID());
    const r = await upsertLayer1EvidenceAnalyticsSnapshot(pool, {
      userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      evidence,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("user_scope_mismatch");
    }
  });
});
