import type { PoolClient } from "pg";

type DbClient = Pick<PoolClient, "query">;

/**
 * Sets `email_verified_at` on first success; if already set, leaves the timestamp unchanged.
 * Intended to run inside `withConsumedEmailVerificationToken` (same transaction / row locks).
 */
export async function markUserEmailVerifiedIfUnverified(
  client: DbClient,
  userId: string,
): Promise<{ email: string; newlyVerified: boolean }> {
  const { rows } = await client.query<{
    email: string;
    email_verified_at: Date | null;
  }>(
    `select email, email_verified_at from users where id = $1::uuid for update`,
    [userId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("email verification: user row missing");
  }
  if (row.email_verified_at) {
    return { email: row.email, newlyVerified: false };
  }
  await client.query(
    `update users set email_verified_at = now(), updated_at = now() where id = $1::uuid`,
    [userId],
  );
  return { email: row.email, newlyVerified: true };
}
