import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import {
  insertAdminAuditEvent,
  listAdminAuditEvents,
  listAdminAuditEventsWithActorEmail,
} from "./adminAuditEvents.js";

const ACTOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET_USER_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

describe.sequential("adminAuditEvents (PGlite)", () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
    await applyMigrationsToPglite(pglite);
  });

  afterAll(async () => {
    await pglite.close();
  });

  it("persists and lists events scoped by actor and target", async () => {
    await pglite.query(
      `insert into users (id, email, password_hash)
       values ($1::uuid, 'admin-audit-actor@example.test', 'x'),
              ($2::uuid, 'admin-audit-target@example.test', 'y')`,
      [ACTOR_ID, TARGET_USER_ID],
    );
    const pool = pgliteAsPool(pglite);
    await insertAdminAuditEvent(pool, {
      actorUserId: ACTOR_ID,
      action: "admin.user.account_role_changed",
      targetType: "user",
      targetId: TARGET_USER_ID,
      payload: { fromRole: "user", toRole: "admin" },
    });
    const byActor = await listAdminAuditEvents(pool, { actorUserId: ACTOR_ID, limit: 50 });
    expect(byActor.some((e) => e.action === "admin.user.account_role_changed")).toBe(true);
    expect(byActor.every((e) => e.actor_user_id === ACTOR_ID)).toBe(true);

    const byTarget = await listAdminAuditEvents(pool, {
      targetType: "user",
      targetId: TARGET_USER_ID,
      limit: 50,
    });
    expect(byTarget.length).toBeGreaterThan(0);
    expect(byTarget[0]?.payload.fromRole).toBe("user");
    expect(byTarget[0]?.payload.toRole).toBe("admin");

    const withActor = await listAdminAuditEventsWithActorEmail(pool, { limit: 50 });
    const roleChange = withActor.find((e) => e.action === "admin.user.account_role_changed");
    expect(roleChange?.actor_email).toBe("admin-audit-actor@example.test");
  });
});
