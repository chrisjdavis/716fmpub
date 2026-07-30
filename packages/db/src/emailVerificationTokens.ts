import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";

type PoolWithConnect = Pick<Pool, "connect">;

type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;

/** Signup / email-bound verification token (single-use; delivery is out of band). */
export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export type EmailVerificationTokenIssue = Readonly<{
  rawToken: string;
  expiresAt: Date;
}>;

export type ConsumeEmailVerificationFailure = "invalid_token" | "expired" | "replayed";

function hashEmailVerificationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function newRawEmailVerificationToken(): string {
  return randomBytes(32).toString("base64url");
}

type VerificationRow = {
  id: string;
  user_id: string;
  consumed_at: Date | null;
  expires_at: Date;
};

/**
 * Revokes other unconsumed verification tokens for this user, then inserts a new row.
 */
export async function issueEmailVerificationToken(
  pool: Db,
  userId: string,
  nowMs: number = Date.now(),
): Promise<EmailVerificationTokenIssue> {
  const rawToken = newRawEmailVerificationToken();
  const tokenHash = hashEmailVerificationToken(rawToken);
  const expiresAt = new Date(nowMs + EMAIL_VERIFICATION_TOKEN_TTL_MS);
  await pool.query(
    `delete from email_verification_tokens
     where user_id = $1::uuid and consumed_at is null`,
    [userId],
  );
  await pool.query(
    `insert into email_verification_tokens (user_id, token_hash, expires_at)
     values ($1::uuid, $2, $3::timestamptz)`,
    [userId, tokenHash, expiresAt.toISOString()],
  );
  return { rawToken, expiresAt };
}

/**
 * Validates a verification token under row lock, runs `run`, marks consumed, commits.
 * If `run` throws, the transaction rolls back and the token remains usable.
 */
export async function withConsumedEmailVerificationToken<T>(
  pool: PoolWithConnect,
  args: Readonly<{
    rawToken: string;
    nowMs?: number;
  }>,
  run: (client: PoolClient, ctx: { userId: string }) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; reason: ConsumeEmailVerificationFailure }> {
  const nowMs = args.nowMs ?? Date.now();
  const tokenHash = hashEmailVerificationToken(args.rawToken);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<VerificationRow>(
      `select id, user_id, consumed_at, expires_at
       from email_verification_tokens
       where token_hash = $1
       for update`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) {
      await client.query("rollback");
      return { ok: false, reason: "invalid_token" };
    }
    if (row.consumed_at) {
      await client.query("rollback");
      return { ok: false, reason: "replayed" };
    }
    const expMs =
      row.expires_at instanceof Date ? row.expires_at.getTime() : Date.parse(String(row.expires_at));
    if (!Number.isFinite(expMs) || expMs <= nowMs) {
      await client.query("rollback");
      return { ok: false, reason: "expired" };
    }

    const value = await run(client, { userId: row.user_id });

    await client.query(
      `update email_verification_tokens set consumed_at = now() where id = $1::uuid`,
      [row.id],
    );
    await client.query("commit");
    return { ok: true, value };
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
