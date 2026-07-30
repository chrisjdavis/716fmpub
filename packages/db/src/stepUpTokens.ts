import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";

type PoolWithConnect = Pick<Pool, "connect">;

type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;

/** Single-purpose tokens for listen/import archive destruction. */
export const STEP_UP_PURPOSE_PURGE_LISTEN_DATA = "purge_listen_data" as const;

/** Password-confirmed gate for starting a verified email change request. */
export const STEP_UP_PURPOSE_CHANGE_ACCOUNT_EMAIL = "change_account_email" as const;

/** Password-confirmed gate for permanently deleting an account and its user-scoped data. */
export const STEP_UP_PURPOSE_DELETE_ACCOUNT = "delete_account" as const;

export type StepUpPurpose =
  | typeof STEP_UP_PURPOSE_PURGE_LISTEN_DATA
  | typeof STEP_UP_PURPOSE_CHANGE_ACCOUNT_EMAIL
  | typeof STEP_UP_PURPOSE_DELETE_ACCOUNT;

export const STEP_UP_PURPOSES: readonly StepUpPurpose[] = [
  STEP_UP_PURPOSE_PURGE_LISTEN_DATA,
  STEP_UP_PURPOSE_CHANGE_ACCOUNT_EMAIL,
  STEP_UP_PURPOSE_DELETE_ACCOUNT,
] as const;

/** Wall-clock lifetime for a issued step-up token (short-lived, single operation). */
export const STEP_UP_TOKEN_TTL_MS = 5 * 60 * 1000;

export type StepUpTokenIssue = Readonly<{
  rawToken: string;
  expiresAt: Date;
}>;

export type ConsumeStepUpFailure =
  | "invalid_token"
  | "expired"
  | "replayed"
  | "wrong_user";

function hashStepUpToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function newRawStepUpToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Revokes other unconsumed tokens for this user+purpose, then inserts a new row.
 */
export async function issueStepUpToken(
  pool: Db,
  userId: string,
  purpose: StepUpPurpose,
  nowMs: number = Date.now(),
): Promise<StepUpTokenIssue> {
  const rawToken = newRawStepUpToken();
  const tokenHash = hashStepUpToken(rawToken);
  const expiresAt = new Date(nowMs + STEP_UP_TOKEN_TTL_MS);
  await pool.query(
    `delete from step_up_tokens
     where user_id = $1::uuid and purpose = $2 and consumed_at is null`,
    [userId, purpose],
  );
  await pool.query(
    `insert into step_up_tokens (user_id, token_hash, purpose, expires_at)
     values ($1::uuid, $2, $3, $4::timestamptz)`,
    [userId, tokenHash, purpose, expiresAt.toISOString()],
  );
  return { rawToken, expiresAt };
}

type StepUpRow = {
  id: string;
  user_id: string;
  purpose: string;
  consumed_at: Date | null;
  expires_at: Date;
};

/**
 * Validates a step-up token under row lock, runs `run`, marks the token consumed, and commits.
 * If `run` throws, the transaction rolls back and the token remains usable.
 */
export async function withConsumedStepUpToken<T>(
  pool: PoolWithConnect,
  args: Readonly<{
    userId: string;
    purpose: StepUpPurpose;
    rawToken: string;
    nowMs?: number;
  }>,
  run: (client: PoolClient) => Promise<T>,
): Promise<
  | { ok: true; value: T }
  | { ok: false; reason: ConsumeStepUpFailure }
> {
  const nowMs = args.nowMs ?? Date.now();
  const tokenHash = hashStepUpToken(args.rawToken);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<StepUpRow>(
      `select id, user_id, purpose, consumed_at, expires_at
       from step_up_tokens
       where token_hash = $1
       for update`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) {
      await client.query("rollback");
      return { ok: false, reason: "invalid_token" };
    }
    if (row.user_id !== args.userId) {
      await client.query("rollback");
      return { ok: false, reason: "wrong_user" };
    }
    if (row.purpose !== args.purpose) {
      await client.query("rollback");
      return { ok: false, reason: "invalid_token" };
    }
    if (row.consumed_at) {
      await client.query("rollback");
      return { ok: false, reason: "replayed" };
    }
    const expMs =
      row.expires_at instanceof Date
        ? row.expires_at.getTime()
        : Date.parse(String(row.expires_at));
    if (!Number.isFinite(expMs) || expMs <= nowMs) {
      await client.query("rollback");
      return { ok: false, reason: "expired" };
    }

    const value = await run(client);

    await client.query(
      `update step_up_tokens set consumed_at = now() where id = $1::uuid`,
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
