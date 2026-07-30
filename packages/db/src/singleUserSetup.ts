import type { PoolClient } from "pg";

type DbQuery = {
  query: PoolClient["query"];
};

/**
 * Count rows in `users` (single-user OSS gate).
 */
export async function countUsers(db: DbQuery): Promise<number> {
  const { rows } = await db.query<{ c: string }>(`select count(*)::text as c from users`);
  return Number.parseInt(rows[0]?.c ?? "0", 10);
}

export type InsertSoleOwnerUserResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "already_configured" };

/**
 * Creates the sole owner account for a self-hosted instance.
 * Caller must `BEGIN` on `client` first. Uses `LOCK TABLE users` so concurrent
 * setup requests cannot both insert.
 */
export async function insertSoleOwnerUser(
  client: PoolClient,
  args: Readonly<{
    canonicalEmail: string;
    passwordHash: string;
  }>,
): Promise<InsertSoleOwnerUserResult> {
  await client.query("lock table users in exclusive mode");
  const existing = await countUsers(client);
  if (existing > 0) {
    return { ok: false, reason: "already_configured" };
  }

  const { rows } = await client.query<{ id: string }>(
    `insert into users (
       email,
       password_hash,
       email_verified_at,
       account_role,
       product_plan
     )
     values ($1, $2, now(), 'owner', 'advanced')
     returning id`,
    [args.canonicalEmail, args.passwordHash],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("insertSoleOwnerUser: user insert returned no row");
  }
  return { ok: true, userId: row.id };
}
