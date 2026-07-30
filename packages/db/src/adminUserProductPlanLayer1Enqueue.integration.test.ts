import { PGlite } from "@electric-sql/pglite";
import type { Queue } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAdminUserProductPlanChange } from "./adminUserMutations.js";
import { enqueueLayer1EvidenceRecomputeForUser } from "./layer1EvidenceRecomputeEnqueue.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";

const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function createMockQueue(): { queue: Queue; addMock: ReturnType<typeof vi.fn> } {
  const addMock = vi.fn().mockResolvedValue({ id: "jq-1" });
  const queue = { add: addMock } as unknown as Queue;
  return { queue, addMock };
}

describe.sequential("admin product plan change vs Layer 1 enqueue (PGlite)", () => {
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
      `insert into users (id, email, password_hash, account_role, account_status, product_plan, created_at)
       values ($1::uuid, 'actor@test', 'h', 'admin', 'active', 'core', '2000-01-01T00:00:00.000Z'),
              ($2::uuid, 'target@test', 'h', 'user', 'active', 'core', '2000-01-02T00:00:00.000Z')`,
      [ACTOR, TARGET],
    );
  });

  it("after Core→Advanced admin mutation, Layer 1 enqueue publishes for the user", async () => {
    const pool = pgliteAsPool(pglite);
    const planR = await applyAdminUserProductPlanChange(pool, {
      targetUserId: TARGET,
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
      userId: TARGET,
      reason: "advanced_upgrade",
      now: new Date("2026-04-15T12:00:00.000Z"),
    });
    expect(out).toEqual({
      outcome: "enqueued",
      userId: TARGET,
      reason: "advanced_upgrade",
    });
    expect(addMock).toHaveBeenCalledTimes(1);
    const [, data] = addMock.mock.calls[0] as [string, { enqueueReason: string }];
    expect(data.enqueueReason).toBe("advanced_upgrade");
  });

  it("after Advanced→Core admin mutation, Layer 1 enqueue still runs (OSS unlocked)", async () => {
    await pglite.query(`update users set product_plan = 'advanced' where id = $1::uuid`, [TARGET]);
    const pool = pgliteAsPool(pglite);
    const planR = await applyAdminUserProductPlanChange(pool, {
      targetUserId: TARGET,
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
    const out = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: TARGET,
      reason: "listen_ingested",
      now: new Date("2026-04-15T12:00:00.000Z"),
    });
    expect(out).toEqual({
      outcome: "enqueued",
      userId: TARGET,
      reason: "listen_ingested",
    });
    expect(addMock).toHaveBeenCalledTimes(1);
  });
});
