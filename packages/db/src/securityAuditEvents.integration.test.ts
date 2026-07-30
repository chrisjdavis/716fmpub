import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import { insertSecurityAuditEvent, listSecurityAuditEvents } from "./securityAuditEvents.js";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe.sequential("securityAuditEvents (PGlite)", () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
    await applyMigrationsToPglite(pglite);
  });

  afterAll(async () => {
    await pglite.close();
  });

  it("persists and lists events for investigation", async () => {
    await pglite.query(
      `insert into users (id, email, password_hash)
       values ($1::uuid, 'audit-test@example.test', 'x')`,
      [USER_ID],
    );
    const pool = pgliteAsPool(pglite);
    await insertSecurityAuditEvent(pool, {
      actorUserId: USER_ID,
      action: "import.trigger",
      outcome: "success",
      metadata: { importJobId: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb" },
    });
    const all = await listSecurityAuditEvents(pool, { actorUserId: null, limit: 50 });
    expect(all.some((e) => e.action === "import.trigger")).toBe(true);

    const scoped = await listSecurityAuditEvents(pool, { actorUserId: USER_ID, limit: 50 });
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((e) => e.actor_user_id === USER_ID)).toBe(true);
    expect(
      scoped.some((e) => e.metadata.importJobId === "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"),
    ).toBe(true);
  });
});
