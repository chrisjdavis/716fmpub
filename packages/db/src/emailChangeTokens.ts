import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { EMAIL_VERIFICATION_TOKEN_TTL_MS } from "./emailVerificationTokens.js";

type PoolWithConnect = Pick<Pool, "connect">;

type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;

/** Same wall-clock window as signup verification (server-defined; not client-inferred). */
export const EMAIL_CHANGE_TOKEN_TTL_MS = EMAIL_VERIFICATION_TOKEN_TTL_MS;

export type EmailChangeTokenIssue = Readonly<{
  rawToken: string;
  expiresAt: Date;
}>;

export type ConsumeEmailChangeFailure = "invalid_token" | "expired" | "replayed";

export class EmailChangeCompletionBlockedError extends Error {
  override readonly name = "EmailChangeCompletionBlockedError";
  readonly code = "email_unavailable" as const;
  /** Owning account for operator audit when completion aborts after a race on `users.email`. */
  readonly userId: string;

  constructor(userId: string) {
    super("email change blocked: target email is no longer available");
    this.userId = userId;
  }
}

function hashEmailChangeToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function newRawEmailChangeToken(): string {
  return randomBytes(32).toString("base64url");
}

type EmailChangeRow = {
  id: string;
  user_id: string;
  new_email: string;
  consumed_at: Date | null;
  expires_at: Date;
};

/**
 * Revokes other unconsumed email-change tokens for this user, then inserts a new row.
 */
export async function issueEmailChangeToken(
  pool: Db,
  userId: string,
  canonicalNewEmail: string,
  nowMs: number = Date.now(),
): Promise<EmailChangeTokenIssue> {
  const rawToken = newRawEmailChangeToken();
  const tokenHash = hashEmailChangeToken(rawToken);
  const expiresAt = new Date(nowMs + EMAIL_CHANGE_TOKEN_TTL_MS);
  await pool.query(
    `delete from email_change_tokens
     where user_id = $1::uuid and consumed_at is null`,
    [userId],
  );
  await pool.query(
    `insert into email_change_tokens (user_id, new_email, token_hash, expires_at)
     values ($1::uuid, $2, $3, $4::timestamptz)`,
    [userId, canonicalNewEmail, tokenHash, expiresAt.toISOString()],
  );
  return { rawToken, expiresAt };
}

/**
 * Locks the account row, rejects if another account already owns `newEmail`, then updates `users.email`
 * and sets `email_verified_at` (new address is trusted only after this path).
 */
export async function applyVerifiedEmailChange(
  client: Pick<PoolClient, "query">,
  args: Readonly<{ userId: string; newEmail: string }>,
): Promise<{ email: string; userId: string }> {
  const { rows: selfRows } = await client.query<{ id: string }>(
    `select id from users where id = $1::uuid for update`,
    [args.userId],
  );
  if (!selfRows[0]) {
    throw new Error("applyVerifiedEmailChange: user row missing");
  }

  const { rows: conflict } = await client.query<{ id: string }>(
    `select id from users where email = $1 and id != $2::uuid for update`,
    [args.newEmail, args.userId],
  );
  if (conflict[0]) {
    throw new EmailChangeCompletionBlockedError(args.userId);
  }

  await client.query(
    `update users
        set email = $2,
            email_verified_at = now(),
            updated_at = now()
      where id = $1::uuid`,
    [args.userId, args.newEmail],
  );
  return { email: args.newEmail, userId: args.userId };
}

/**
 * Validates an email-change token under row lock, runs `run`, marks consumed, commits.
 * If `run` throws, the transaction rolls back and the token remains usable.
 */
export async function withConsumedEmailChangeToken<T>(
  pool: PoolWithConnect,
  args: Readonly<{
    rawToken: string;
    nowMs?: number;
  }>,
  run: (client: PoolClient, ctx: { userId: string; newEmail: string }) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; reason: ConsumeEmailChangeFailure }> {
  const nowMs = args.nowMs ?? Date.now();
  const tokenHash = hashEmailChangeToken(args.rawToken);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<EmailChangeRow>(
      `select id, user_id, new_email, consumed_at, expires_at
         from email_change_tokens
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

    const value = await run(client, { userId: row.user_id, newEmail: row.new_email });

    await client.query(
      `update email_change_tokens set consumed_at = now() where id = $1::uuid`,
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
