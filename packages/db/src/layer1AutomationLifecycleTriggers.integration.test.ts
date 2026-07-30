/**
 * VS-89 TASK 8.1 — Layer 1 automation triggers at the DB enqueue boundary.
 *
 * Worker entrypoints (`enqueueLayer1AfterLastfmImportCompletion`, `enqueueLayer1AfterMeaningfulListenIngestion`)
 * call {@link enqueueLayer1EvidenceRecomputeForUserBestEffort} with `import_completed` / `listen_ingested`.
 * Admin Core→Advanced uses {@link enqueueLayer1EvidenceRecomputeForAdminCoreToAdvancedUpgradeBestEffort} → `advanced_upgrade`.
 */
import { PGlite } from "@electric-sql/pglite";
import type { Queue } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAdminUserProductPlanChange } from "./adminUserMutations.js";
import { enqueueLayer1EvidenceRecomputeForUser } from "./layer1EvidenceRecomputeEnqueue.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";

const USER_ADV = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const USER_CORE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createMockQueue(): { queue: Queue; addMock: ReturnType<typeof vi.fn> } {
  const addMock = vi.fn().mockResolvedValue({ id: "jq-vs89" });
  const queue = { add: addMock } as unknown as Queue;
  return { queue, addMock };
}

describe.sequential("VS-89 TASK 8.1 — Layer 1 automation lifecycle triggers (PGlite)", () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
    await applyMigrationsToPglite(pglite);
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(async () => {
    await pglite.exec("TRUNCATE TABLE admin_audit_events");
    await pglite.exec("TRUNCATE TABLE users CASCADE");
    await pglite.query(
      `insert into users (id, email, password_hash, product_plan) values
         ($1::uuid, 'vs89-adv@example.test', 'x', 'advanced'),
         ($2::uuid, 'vs89-core@example.test', 'x', 'core'),
         ($3::uuid, 'vs89-actor@example.test', 'x', 'core')`,
      [USER_ADV, USER_CORE, ACTOR],
    );
  });

  it("import completion: Advanced user enqueues layer1_evidence_recompute with import_completed", async () => {
    const pool = pgliteAsPool(pglite);
    const { queue, addMock } = createMockQueue();
    const out = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_ADV,
      reason: "import_completed",
      now: new Date("2026-04-15T12:00:00.000Z"),
    });
    expect(out).toEqual({
      outcome: "enqueued",
      userId: USER_ADV,
      reason: "import_completed",
    });
    expect(addMock).toHaveBeenCalledTimes(1);
    const [, data] = addMock.mock.calls[0] as [string, { enqueueReason: string }];
    expect(data.enqueueReason).toBe("import_completed");
  });

  it("import completion: Core user enqueues (OSS: Advanced unlocked)", async () => {
    const pool = pgliteAsPool(pglite);
    const { queue, addMock } = createMockQueue();
    const out = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_CORE,
      reason: "import_completed",
    });
    expect(out).toEqual({
      outcome: "enqueued",
      userId: USER_CORE,
      reason: "import_completed",
    });
    expect(addMock).toHaveBeenCalledTimes(1);
  });

  it("listen / scrobble ingestion: Advanced user enqueues with listen_ingested", async () => {
    const pool = pgliteAsPool(pglite);
    const { queue, addMock } = createMockQueue();
    const out = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_ADV,
      reason: "listen_ingested",
      now: new Date("2026-04-15T12:00:00.000Z"),
    });
    expect(out).toEqual({
      outcome: "enqueued",
      userId: USER_ADV,
      reason: "listen_ingested",
    });
    expect(addMock).toHaveBeenCalledTimes(1);
    const [, data] = addMock.mock.calls[0] as [string, { enqueueReason: string }];
    expect(data.enqueueReason).toBe("listen_ingested");
  });

  it("Advanced upgrade: after Core→Advanced, advanced_upgrade reason publishes to the queue", async () => {
    const pool = pgliteAsPool(pglite);
    const planR = await applyAdminUserProductPlanChange(pool, {
      targetUserId: USER_CORE,
      nextPlan: "advanced",
      actorUserId: ACTOR,
    });
    expect(planR).toMatchObject({
      ok: true,
      priorPlan: "core",
      nextPlan: "advanced",
      noop: false,
    });

    const { queue, addMock } = createMockQueue();
    const out = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_CORE,
      reason: "advanced_upgrade",
      now: new Date("2026-04-15T12:00:00.000Z"),
    });
    expect(out).toEqual({
      outcome: "enqueued",
      userId: USER_CORE,
      reason: "advanced_upgrade",
    });
    expect(addMock).toHaveBeenCalledTimes(1);
    const [, data] = addMock.mock.calls[0] as [string, { enqueueReason: string }];
    expect(data.enqueueReason).toBe("advanced_upgrade");
  });

  it("downgrade: after Advanced→Core, automatic lifecycle reasons still publish (OSS unlocked)", async () => {
    const pool = pgliteAsPool(pglite);
    const planR = await applyAdminUserProductPlanChange(pool, {
      targetUserId: USER_ADV,
      nextPlan: "core",
      actorUserId: ACTOR,
    });
    expect(planR).toMatchObject({
      ok: true,
      priorPlan: "advanced",
      nextPlan: "core",
      noop: false,
    });

    const { queue, addMock } = createMockQueue();
    for (const reason of ["import_completed", "listen_ingested"] as const) {
      addMock.mockClear();
      const out = await enqueueLayer1EvidenceRecomputeForUser({
        db: pool,
        queue,
        userId: USER_ADV,
        reason,
        now: new Date("2026-04-15T12:00:00.000Z"),
      });
      expect(out).toEqual({
        outcome: "enqueued",
        userId: USER_ADV,
        reason,
      });
      expect(addMock).toHaveBeenCalledTimes(1);
    }
  });
});
