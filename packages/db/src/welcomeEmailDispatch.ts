import type { Pool } from "pg";

type DbQuery = Pick<Pool, "query">;

/**
 * Reserves a one-time welcome send for this user by setting `welcome_email_sent_at`
 * before transport runs. Call {@link releaseWelcomeEmailDispatchSlot} if Mailgun
 * rejects the message so the user can receive a later retry.
 */
export async function claimWelcomeEmailDispatchSlot(
  db: DbQuery,
  userId: string,
): Promise<{ email: string } | null> {
  const { rows } = await db.query<{ email: string }>(
    `update users
     set welcome_email_sent_at = now(), updated_at = now()
     where id = $1::uuid and welcome_email_sent_at is null
     returning email`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function releaseWelcomeEmailDispatchSlot(db: DbQuery, userId: string): Promise<void> {
  await db.query(
    `update users set welcome_email_sent_at = null, updated_at = now() where id = $1::uuid`,
    [userId],
  );
}
