import type { AccountRole, AccountStatus, ProductPlan } from "@vs/domain";
import { isAccountRole, isAccountStatus, isProductPlan } from "@vs/domain";
import type { Pool } from "pg";
import { insertAdminAuditEvent } from "./adminAuditEvents.js";

/** Minimal surface for transactional helpers (real `Pool` and PGlite test adapters). */
type ConnectablePool = Pick<Pool, "connect">;

function isValidAccountStatusTransition(
  prior: AccountStatus,
  next: AccountStatus,
): boolean {
  if (prior === next) {
    return true;
  }
  if (next === "active") {
    return prior === "disabled" || prior === "suspended";
  }
  if (next === "disabled" || next === "suspended") {
    return prior === "active";
  }
  return false;
}

export type AdminUserRoleMutationResult =
  | { ok: true; priorRole: AccountRole; nextRole: AccountRole; noop: boolean }
  | { ok: false; code: "user_not_found" }
  | { ok: false; code: "last_owner_demotion_blocked" }
  | { ok: false; code: "owner_role_change_requires_owner_actor" }
  | { ok: false; code: "invalid_account_role_state" };

export type AdminUserStatusMutationResult =
  | { ok: true; priorStatus: AccountStatus; nextStatus: AccountStatus; noop: boolean }
  | { ok: false; code: "user_not_found" }
  | { ok: false; code: "invalid_account_status_transition" }
  | { ok: false; code: "last_owner_non_active_forbidden" }
  | { ok: false; code: "self_suspend_forbidden" }
  | { ok: false; code: "invalid_account_status_state" };

export type AdminUserProductPlanMutationResult =
  | { ok: true; priorPlan: ProductPlan; nextPlan: ProductPlan; noop: boolean }
  | { ok: false; code: "user_not_found" }
  | { ok: false; code: "invalid_product_plan_state" };

/**
 * Serialized role updates touching `owner` rows plus explicit last-owner checks.
 */
export async function applyAdminUserAccountRoleChange(
  pool: ConnectablePool,
  args: Readonly<{
    targetUserId: string;
    nextRole: AccountRole;
    actorAccountRole: AccountRole;
    actorUserId: string;
  }>,
): Promise<AdminUserRoleMutationResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const { rows: targetRows } = await client.query<{ account_role: string }>(
      `select account_role from users where id = $1::uuid for update`,
      [args.targetUserId],
    );
    const rawPrior = targetRows[0]?.account_role;
    if (rawPrior === undefined) {
      await client.query("rollback");
      return { ok: false, code: "user_not_found" };
    }
    if (!isAccountRole(rawPrior)) {
      await client.query("rollback");
      return { ok: false, code: "invalid_account_role_state" };
    }
    const priorRole = rawPrior;
    if (priorRole === args.nextRole) {
      await client.query("commit");
      return { ok: true, priorRole, nextRole: args.nextRole, noop: true };
    }

    const touchesOwnerTier = priorRole === "owner" || args.nextRole === "owner";
    if (touchesOwnerTier && args.actorAccountRole !== "owner") {
      await client.query("rollback");
      return { ok: false, code: "owner_role_change_requires_owner_actor" };
    }

    if (touchesOwnerTier) {
      await client.query(
        `select id from users where account_role = 'owner' order by id for update`,
      );
    }

    if (priorRole === "owner" && args.nextRole !== "owner") {
      const { rows: countRows } = await client.query<{ c: string }>(
        `select count(*)::text as c from users where account_role = 'owner'`,
      );
      const n = Number(countRows[0]?.c ?? "0");
      if (!Number.isFinite(n) || n <= 1) {
        await client.query("rollback");
        return { ok: false, code: "last_owner_demotion_blocked" };
      }
    }

    await client.query(
      `update users set account_role = $2::text, updated_at = now() where id = $1::uuid`,
      [args.targetUserId, args.nextRole],
    );

    await insertAdminAuditEvent(client, {
      actorUserId: args.actorUserId,
      action: "admin.user.account_role_changed",
      targetType: "user",
      targetId: args.targetUserId,
      payload: { priorRole, nextRole: args.nextRole },
    });

    await client.query("commit");
    return { ok: true, priorRole, nextRole: args.nextRole, noop: false };
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Account status transitions enforced in one transaction with sole-owner protection.
 */
export async function applyAdminUserAccountStatusChange(
  pool: ConnectablePool,
  args: Readonly<{
    targetUserId: string;
    nextStatus: AccountStatus;
    actorUserId: string;
  }>,
): Promise<AdminUserStatusMutationResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const { rows: targetRows } = await client.query<{
      account_role: string;
      account_status: string;
    }>(
      `select account_role, account_status from users where id = $1::uuid for update`,
      [args.targetUserId],
    );
    const row = targetRows[0];
    if (!row) {
      await client.query("rollback");
      return { ok: false, code: "user_not_found" };
    }
    if (!isAccountRole(row.account_role) || !isAccountStatus(row.account_status)) {
      await client.query("rollback");
      return { ok: false, code: "invalid_account_status_state" };
    }
    const priorStatus = row.account_status;
    if (priorStatus === args.nextStatus) {
      await client.query("commit");
      return { ok: true, priorStatus, nextStatus: args.nextStatus, noop: true };
    }

    if (!isValidAccountStatusTransition(priorStatus, args.nextStatus)) {
      await client.query("rollback");
      return { ok: false, code: "invalid_account_status_transition" };
    }

    if (
      args.targetUserId === args.actorUserId &&
      (args.nextStatus === "disabled" || args.nextStatus === "suspended")
    ) {
      await client.query("rollback");
      return { ok: false, code: "self_suspend_forbidden" };
    }

    if (
      row.account_role === "owner" &&
      args.nextStatus !== "active" &&
      priorStatus === "active"
    ) {
      await client.query(`select id from users where account_role = 'owner' order by id for update`);
      const { rows: countRows } = await client.query<{ c: string }>(
        `select count(*)::text as c from users where account_role = 'owner'`,
      );
      const n = Number(countRows[0]?.c ?? "0");
      if (!Number.isFinite(n) || n <= 1) {
        await client.query("rollback");
        return { ok: false, code: "last_owner_non_active_forbidden" };
      }
    }

    await client.query(
      `update users set account_status = $2::text, updated_at = now() where id = $1::uuid`,
      [args.targetUserId, args.nextStatus],
    );

    await insertAdminAuditEvent(client, {
      actorUserId: args.actorUserId,
      action: "admin.user.account_status_changed",
      targetType: "user",
      targetId: args.targetUserId,
      payload: { priorStatus, nextStatus: args.nextStatus },
    });

    await client.query("commit");
    return { ok: true, priorStatus, nextStatus: args.nextStatus, noop: false };
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Updates `users.product_plan` for billing tier changes.
 *
 * **Authorization (VS-67):** Like {@link applyAdminUserAccountStatusChange}, this does not
 * require an `owner` actor — any staff session eligible for admin surfaces may apply it.
 * Owner-tier protections remain exclusively on account role (and related status rules).
 */
export async function applyAdminUserProductPlanChange(
  pool: ConnectablePool,
  args: Readonly<{
    targetUserId: string;
    nextPlan: ProductPlan;
    actorUserId: string;
  }>,
): Promise<AdminUserProductPlanMutationResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const { rows: targetRows } = await client.query<{ product_plan: string }>(
      `select product_plan from users where id = $1::uuid for update`,
      [args.targetUserId],
    );
    const rawPrior = targetRows[0]?.product_plan;
    if (rawPrior === undefined) {
      await client.query("rollback");
      return { ok: false, code: "user_not_found" };
    }
    if (!isProductPlan(rawPrior)) {
      await client.query("rollback");
      return { ok: false, code: "invalid_product_plan_state" };
    }
    const priorPlan = rawPrior;
    if (priorPlan === args.nextPlan) {
      await client.query("commit");
      return { ok: true, priorPlan, nextPlan: args.nextPlan, noop: true };
    }

    await client.query(
      `update users set product_plan = $2::text, updated_at = now() where id = $1::uuid`,
      [args.targetUserId, args.nextPlan],
    );

    await insertAdminAuditEvent(client, {
      actorUserId: args.actorUserId,
      action: "admin.user.product_plan_changed",
      targetType: "user",
      targetId: args.targetUserId,
      payload: { priorPlan, nextPlan: args.nextPlan },
    });

    await client.query("commit");
    return { ok: true, priorPlan, nextPlan: args.nextPlan, noop: false };
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}
