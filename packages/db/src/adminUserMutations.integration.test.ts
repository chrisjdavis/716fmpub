import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  applyAdminUserAccountRoleChange,
  applyAdminUserAccountStatusChange,
  applyAdminUserProductPlanChange,
} from "./adminUserMutations.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";

const O1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const O2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const U1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe.sequential("adminUserMutations (PGlite)", () => {
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
      `insert into users (id, email, password_hash, account_role, account_status, created_at)
       values ($1::uuid, 'o1@test', 'h', 'owner', 'active', '2000-01-01T00:00:00.000Z'),
              ($2::uuid, 'o2@test', 'h', 'owner', 'active', '2000-01-02T00:00:00.000Z'),
              ($3::uuid, 'ad@test', 'h', 'admin', 'active', '2000-01-03T00:00:00.000Z'),
              ($4::uuid, 'u1@test', 'h', 'user', 'active', '2000-01-04T00:00:00.000Z')`,
      [O1, O2, AD, U1],
    );
  });

  it("blocks demoting the last owner", async () => {
    await pglite.exec("TRUNCATE TABLE users CASCADE");
    await pglite.query(
      `insert into users (id, email, password_hash, account_role, account_status, created_at)
       values ($1::uuid, 'solo@test', 'h', 'owner', 'active', '2000-01-01T00:00:00.000Z')`,
      [O1],
    );
    const pool = pgliteAsPool(pglite);
    const r = await applyAdminUserAccountRoleChange(pool, {
      targetUserId: O1,
      nextRole: "admin",
      actorAccountRole: "owner",
      actorUserId: O1,
    });
    expect(r).toEqual({ ok: false, code: "last_owner_demotion_blocked" });
  });

  it("allows owner demotion when another owner exists", async () => {
    const pool = pgliteAsPool(pglite);
    const r = await applyAdminUserAccountRoleChange(pool, {
      targetUserId: O2,
      nextRole: "admin",
      actorAccountRole: "owner",
      actorUserId: O1,
    });
    expect(r).toMatchObject({ ok: true, priorRole: "owner", nextRole: "admin", noop: false });
  });

  it("requires owner actor for owner-tier role changes", async () => {
    const pool = pgliteAsPool(pglite);
    const promote = await applyAdminUserAccountRoleChange(pool, {
      targetUserId: U1,
      nextRole: "owner",
      actorAccountRole: "admin",
      actorUserId: AD,
    });
    expect(promote).toEqual({ ok: false, code: "owner_role_change_requires_owner_actor" });

    const demote = await applyAdminUserAccountRoleChange(pool, {
      targetUserId: O1,
      nextRole: "admin",
      actorAccountRole: "admin",
      actorUserId: AD,
    });
    expect(demote).toEqual({ ok: false, code: "owner_role_change_requires_owner_actor" });
  });

  it("allows admin to change non-owner roles", async () => {
    const pool = pgliteAsPool(pglite);
    const r = await applyAdminUserAccountRoleChange(pool, {
      targetUserId: U1,
      nextRole: "admin",
      actorAccountRole: "admin",
      actorUserId: AD,
    });
    expect(r).toMatchObject({ ok: true, priorRole: "user", nextRole: "admin", noop: false });
  });

  it("returns noop when role unchanged", async () => {
    const pool = pgliteAsPool(pglite);
    const r = await applyAdminUserAccountRoleChange(pool, {
      targetUserId: U1,
      nextRole: "user",
      actorAccountRole: "admin",
      actorUserId: AD,
    });
    expect(r).toMatchObject({ ok: true, noop: true });
  });

  it("returns user_not_found for unknown id", async () => {
    const pool = pgliteAsPool(pglite);
    const r = await applyAdminUserAccountRoleChange(pool, {
      targetUserId: "99999999-9999-4999-8999-999999999999",
      nextRole: "user",
      actorAccountRole: "owner",
      actorUserId: O1,
    });
    expect(r).toEqual({ ok: false, code: "user_not_found" });
  });

  it("rejects invalid status transitions", async () => {
    const pool = pgliteAsPool(pglite);
    await pglite.query(
      `update users set account_status = 'disabled' where id = $1::uuid`,
      [U1],
    );
    const r = await applyAdminUserAccountStatusChange(pool, {
      targetUserId: U1,
      nextStatus: "suspended",
      actorUserId: AD,
    });
    expect(r).toEqual({ ok: false, code: "invalid_account_status_transition" });
  });

  it("applies suspend and restore", async () => {
    const pool = pgliteAsPool(pglite);
    const s = await applyAdminUserAccountStatusChange(pool, {
      targetUserId: U1,
      nextStatus: "suspended",
      actorUserId: AD,
    });
    expect(s).toMatchObject({ ok: true, priorStatus: "active", nextStatus: "suspended" });

    const a = await applyAdminUserAccountStatusChange(pool, {
      targetUserId: U1,
      nextStatus: "active",
      actorUserId: AD,
    });
    expect(a).toMatchObject({ ok: true, priorStatus: "suspended", nextStatus: "active" });
  });

  it("blocks sole owner from disabling their own account (self suspend)", async () => {
    await pglite.exec("TRUNCATE TABLE users CASCADE");
    await pglite.query(
      `insert into users (id, email, password_hash, account_role, account_status, created_at)
       values ($1::uuid, 'solo@test', 'h', 'owner', 'active', '2000-01-01T00:00:00.000Z')`,
      [O1],
    );
    const pool = pgliteAsPool(pglite);
    const r = await applyAdminUserAccountStatusChange(pool, {
      targetUserId: O1,
      nextStatus: "disabled",
      actorUserId: O1,
    });
    expect(r).toEqual({ ok: false, code: "self_suspend_forbidden" });
  });

  it("blocks admin suspending sole owner account", async () => {
    await pglite.exec("TRUNCATE TABLE users CASCADE");
    await pglite.query(
      `insert into users (id, email, password_hash, account_role, account_status, created_at)
       values ($1::uuid, 'solo@test', 'h', 'owner', 'active', '2000-01-01T00:00:00.000Z'),
              ($2::uuid, 'ad2@test', 'h', 'admin', 'active', '2000-01-02T00:00:00.000Z')`,
      [O1, AD],
    );
    const pool = pgliteAsPool(pglite);
    const r = await applyAdminUserAccountStatusChange(pool, {
      targetUserId: O1,
      nextStatus: "suspended",
      actorUserId: AD,
    });
    expect(r).toEqual({ ok: false, code: "last_owner_non_active_forbidden" });
  });

  it("allows suspending one owner when another owner exists", async () => {
    const pool = pgliteAsPool(pglite);
    const r = await applyAdminUserAccountStatusChange(pool, {
      targetUserId: O2,
      nextStatus: "suspended",
      actorUserId: AD,
    });
    expect(r).toMatchObject({ ok: true, priorStatus: "active", nextStatus: "suspended" });
  });

  it("persists admin_audit_events in the same transaction as a successful role change", async () => {
    const pool = pgliteAsPool(pglite);
    await applyAdminUserAccountRoleChange(pool, {
      targetUserId: U1,
      nextRole: "admin",
      actorAccountRole: "admin",
      actorUserId: AD,
    });
    const { rows } = await pglite.query<{ action: string; target_id: string }>(
      `select action, target_id::text from admin_audit_events`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("admin.user.account_role_changed");
    expect(rows[0]?.target_id).toBe(U1);
  });

  it("persists admin_audit_events in the same transaction as a successful product plan change", async () => {
    const pool = pgliteAsPool(pglite);
    const r = await applyAdminUserProductPlanChange(pool, {
      targetUserId: U1,
      nextPlan: "advanced",
      actorUserId: AD,
    });
    expect(r).toMatchObject({
      ok: true,
      priorPlan: "core",
      nextPlan: "advanced",
      noop: false,
    });
    const { rows } = await pglite.query<{
      action: string;
      target_id: string;
      prior_plan: string | null;
      next_plan: string | null;
    }>(
      `select action, target_id::text,
              payload->>'priorPlan' as prior_plan,
              payload->>'nextPlan' as next_plan
         from admin_audit_events`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("admin.user.product_plan_changed");
    expect(rows[0]?.target_id).toBe(U1);
    expect(rows[0]?.prior_plan).toBe("core");
    expect(rows[0]?.next_plan).toBe("advanced");
  });

  it("does not change account_role or account_status when updating product_plan", async () => {
    const pool = pgliteAsPool(pglite);
    const { rows: before } = await pglite.query<{
      account_role: string;
      account_status: string;
      product_plan: string;
    }>(
      `select account_role, account_status, product_plan from users where id = $1::uuid`,
      [U1],
    );
    expect(before[0]).toMatchObject({
      account_role: "user",
      account_status: "active",
      product_plan: "core",
    });

    await applyAdminUserProductPlanChange(pool, {
      targetUserId: U1,
      nextPlan: "advanced",
      actorUserId: O1,
    });

    const { rows: after } = await pglite.query<{
      account_role: string;
      account_status: string;
      product_plan: string;
    }>(
      `select account_role, account_status, product_plan from users where id = $1::uuid`,
      [U1],
    );
    expect(after[0]).toMatchObject({
      account_role: "user",
      account_status: "active",
      product_plan: "advanced",
    });
  });

  it("returns noop for unchanged product plan without writing audit", async () => {
    const pool = pgliteAsPool(pglite);
    const r = await applyAdminUserProductPlanChange(pool, {
      targetUserId: U1,
      nextPlan: "core",
      actorUserId: AD,
    });
    expect(r).toMatchObject({ ok: true, noop: true });
    const { rows } = await pglite.query(`select id from admin_audit_events`);
    expect(rows).toHaveLength(0);
  });
});
