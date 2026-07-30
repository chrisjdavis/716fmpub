import type { Pool } from "pg";
import { canonicalizeAccountEmail, isAccountRole, type AccountRole } from "@vs/domain";

type Db = Pick<Pool, "query">;

/** Values the operator bootstrap path may assign (never `user`). */
export type BootstrapPromotionRole = "owner" | "admin";

export type BootstrapAccountRoleResult =
  | { ok: true; skipped: true; reason: "missing_email" }
  | { ok: false; error: "user_not_found"; email: string }
  | { ok: false; error: "account_not_active"; email: string }
  | {
      ok: true;
      skipped: false;
      userId: string;
      previousRole: AccountRole;
      newRole: BootstrapPromotionRole;
      /** False when `account_role` already matched the requested privileged role. */
      didUpdate: boolean;
    };

function parseBootstrapTargetRole(raw: string | undefined): BootstrapPromotionRole | null {
  const t = raw?.trim().toLowerCase();
  if (t === undefined || t === "") {
    return "owner";
  }
  if (t === "owner" || t === "admin") {
    return t;
  }
  return null;
}

/**
 * Promotes the account identified by canonical `users.email` to `owner` or `admin`.
 * Email must match the stored row (same normalization as signup). For unusual Gmail variants,
 * copy the exact `users.email` value from Postgres.
 */
export async function applyBootstrapAccountRole(
  db: Db,
  input: Readonly<{ email: string; targetRole: BootstrapPromotionRole }>,
): Promise<BootstrapAccountRoleResult> {
  const email = input.email.trim();
  if (email.length === 0) {
    return { ok: true, skipped: true, reason: "missing_email" };
  }
  const canonicalEmail = canonicalizeAccountEmail(email);
  const { rows } = await db.query<{
    id: string;
    account_role: string;
    account_status: string;
  }>(
    `select id, account_role, account_status from users where email = $1 limit 1`,
    [canonicalEmail],
  );
  const row = rows[0];
  if (!row) {
    return { ok: false, error: "user_not_found", email: canonicalEmail };
  }
  if (!isAccountRole(row.account_role)) {
    return { ok: false, error: "user_not_found", email: canonicalEmail };
  }
  if (row.account_status !== "active") {
    return { ok: false, error: "account_not_active", email: canonicalEmail };
  }
  const previousRole = row.account_role;
  const newRole = input.targetRole;
  if (previousRole === newRole) {
    return {
      ok: true,
      skipped: false,
      userId: row.id,
      previousRole,
      newRole,
      didUpdate: false,
    };
  }
  await db.query(
    `update users set account_role = $2::text, updated_at = now() where id = $1::uuid`,
    [row.id, newRole],
  );
  return {
    ok: true,
    skipped: false,
    userId: row.id,
    previousRole,
    newRole,
    didUpdate: true,
  };
}

/**
 * Reads `VS_BOOTSTRAP_ACCOUNT_ROLE_EMAIL` and optional `VS_BOOTSTRAP_ACCOUNT_ROLE`
 * (`owner` default, or `admin`) from the environment.
 */
export function readBootstrapAccountRoleEnv(): {
  email: string | undefined;
  targetRole: BootstrapPromotionRole | null;
  rawTarget: string | undefined;
} {
  const email = process.env.VS_BOOTSTRAP_ACCOUNT_ROLE_EMAIL?.trim();
  const rawTarget = process.env.VS_BOOTSTRAP_ACCOUNT_ROLE;
  return {
    email: email && email.length > 0 ? email : undefined,
    targetRole: parseBootstrapTargetRole(rawTarget),
    rawTarget,
  };
}
