import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ARTIST_USER_RELATIONSHIP_SIGNAL_KIND,
  parseLayer1EvidenceObject,
} from "@vs/domain";
import { canonicalizePendingRawScrobblesBatch } from "./canonicalizeRawScrobbles.js";
import { batchInsertRawScrobbles } from "./rawScrobbles.js";
import {
  ANALYTICS_FIXTURE_NOW_MS,
  realisticLastfmImportRows,
} from "./test/analyticsImportFixtures.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import { runLayer1EvidenceRecomputeJob } from "./layer1EvidenceRecomputeJob.js";

/**
 * VS-55 — end-to-end: fixture import rows → canonical listens → Layer 1 job → DB inspection.
 */
const USER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const JOB_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

describe.sequential("Layer 1 seed → recompute → inspection (PGlite)", () => {
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
       values ($1::uuid, 'layer1-e2e@example.test', 'not-a-real-hash')`,
      [USER_ID],
    );
    await pglite.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username)
       values ($1::uuid, $2::uuid, 'fixture_user', 'running', 'fixture_user')`,
      [JOB_ID, USER_ID],
    );
    const pool = pgliteAsPool(pglite);
    const insert = await batchInsertRawScrobbles(pool, {
      importJobId: JOB_ID,
      userId: USER_ID,
      rows: realisticLastfmImportRows(),
    });
    expect(insert.inserted).toBe(4);
    const canon = await canonicalizePendingRawScrobblesBatch(pool, {
      importJobId: JOB_ID,
      userId: USER_ID,
      limit: 50,
    });
    expect(canon).toEqual({ examined: 4, succeeded: 4, failed: 0 });
  });

  it("materializes inspectable artist.user_relationship.v1 evidence and stays idempotent on rerun", async () => {
    const pool = pgliteAsPool(pglite);
    const first = await runLayer1EvidenceRecomputeJob(pool, {
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
      scope: { kind: "explicit_user_ids", userIds: [USER_ID] },
      triggerKind: "test.layer1.e2e",
      enqueueReason: "import_completed",
      artistLimit: 10,
    });
    expect(first.runStatus).toBe("succeeded");
    expect(first.totals.failure).toBe(0);
    expect(first.totals.usersWithHardError).toBe(0);
    expect(first.userRollups).toHaveLength(1);
    expect(first.userRollups[0]?.userSkipped).toBeNull();
    expect(
      first.userRollups[0]!.success +
        first.userRollups[0]!.skip +
        first.userRollups[0]!.insufficiency +
        first.userRollups[0]!.failure,
    ).toBeGreaterThan(0);

    const { rows: before } = await pglite.query<{ c: string }>(
      `select count(*)::text as c from layer1_evidence_objects
       where user_id = $1::uuid and signal_kind = $2`,
      [USER_ID, ARTIST_USER_RELATIONSHIP_SIGNAL_KIND],
    );
    const nBefore = Number(before[0]?.c ?? 0);
    expect(nBefore).toBeGreaterThanOrEqual(1);

    const { rows: bodies } = await pglite.query<{ body_json: unknown }>(
      `select body_json from layer1_evidence_objects
       where user_id = $1::uuid and signal_kind = $2
       order by signal_instance_id::text asc
       limit 3`,
      [USER_ID, ARTIST_USER_RELATIONSHIP_SIGNAL_KIND],
    );
    for (const row of bodies) {
      const parsed = parseLayer1EvidenceObject(row.body_json);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) {
        continue;
      }
      expect(parsed.value.signalKind).toBe(ARTIST_USER_RELATIONSHIP_SIGNAL_KIND);
      expect(parsed.value.scope.kind).toBe("artist");
      expect(parsed.value.insufficiency.codes.length).toBeGreaterThanOrEqual(1);
      expect(typeof parsed.value.insufficiency.eligibleForDownstreamUse).toBe("boolean");
    }

    const second = await runLayer1EvidenceRecomputeJob(pool, {
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
      scope: { kind: "explicit_user_ids", userIds: [USER_ID] },
      triggerKind: "test.layer1.e2e",
      enqueueReason: "import_completed",
      artistLimit: 10,
    });
    expect(second.runStatus).toBe("succeeded");
    expect(second.layer1SignalRunId).not.toBe(first.layer1SignalRunId);

    const { rows: after } = await pglite.query<{ c: string }>(
      `select count(*)::text as c from layer1_evidence_objects
       where user_id = $1::uuid and signal_kind = $2`,
      [USER_ID, ARTIST_USER_RELATIONSHIP_SIGNAL_KIND],
    );
    expect(Number(after[0]?.c ?? 0)).toBe(nBefore);
  });
});
