import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";

type PoolWithConnect = Pick<Pool, "connect">;

type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;

/** Short-lived password recovery token (email-bound flow; delivery is out of band). */
export const PASSWORD_RECOVERY_TOKEN_TTL_MS = 60 * 60 * 1000;

export type PasswordRecoveryTokenIssue = Readonly<{
  rawToken: string;
  expiresAt: Date;
}>;

export type ConsumePasswordRecoveryFailure =
  | "invalid_token"
  | "expired"
  | "replayed"
  /** User row exists but `users.account_status` is not `active`; token is not consumed. */
  | "account_not_active";

function hashPasswordRecoveryToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function newRawPasswordRecoveryToken(): string {
  return randomBytes(32).toString("base64url");
}

type RecoveryRow = {
  id: string;
  user_id: string;
  consumed_at: Date | null;
  expires_at: Date;
};

type RecoveryInspectRow = {
  consumed_at: Date | null;
  expires_at: Date;
};

/**
 * Revokes other unconsumed recovery tokens for this user, then inserts a new row.
 */
export async function issuePasswordRecoveryToken(
  pool: Db,
  userId: string,
  nowMs: number = Date.now(),
): Promise<PasswordRecoveryTokenIssue> {
  const rawToken = newRawPasswordRecoveryToken();
  const tokenHash = hashPasswordRecoveryToken(rawToken);
  const expiresAt = new Date(nowMs + PASSWORD_RECOVERY_TOKEN_TTL_MS);
  await pool.query(
    `delete from password_recovery_tokens
     where user_id = $1::uuid and consumed_at is null`,
    [userId],
  );
  await pool.query(
    `insert into password_recovery_tokens (user_id, token_hash, expires_at)
     values ($1::uuid, $2, $3::timestamptz)`,
    [userId, tokenHash, expiresAt.toISOString()],
  );
  return { rawToken, expiresAt };
}

/**
 * Read-only token check for UX (does not consume the token). The result can
 * change before the user submits `POST /api/auth/recovery/confirm`; that route
 * remains authoritative.
 */
export async function inspectPasswordRecoveryToken(
  pool: Db,
  args: Readonly<{
    rawToken: string;
    nowMs?: number;
  }>,
): Promise<{ ok: true } | { ok: false; reason: ConsumePasswordRecoveryFailure }> {
  const nowMs = args.nowMs ?? Date.now();
  const tokenHash = hashPasswordRecoveryToken(args.rawToken);
  const { rows } = await pool.query<RecoveryInspectRow>(
    `select consumed_at, expires_at
     from password_recovery_tokens
     where token_hash = $1`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) {
    return { ok: false, reason: "invalid_token" };
  }
  if (row.consumed_at) {
    return { ok: false, reason: "replayed" };
  }
  const expMs =
    row.expires_at instanceof Date
      ? row.expires_at.getTime()
      : Date.parse(String(row.expires_at));
  if (!Number.isFinite(expMs) || expMs <= nowMs) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

/**
 * Validates a recovery token under row lock, runs `run`, marks consumed, commits.
 * If `run` throws, the transaction rolls back and the token remains usable.
 */
export async function withConsumedPasswordRecoveryToken<T>(
  pool: PoolWithConnect,
  args: Readonly<{
    rawToken: string;
    nowMs?: number;
  }>,
  run: (client: PoolClient, ctx: { userId: string }) => Promise<T>,
): Promise<
  | { ok: true; value: T }
  | { ok: false; reason: ConsumePasswordRecoveryFailure }
> {
  const nowMs = args.nowMs ?? Date.now();
  const tokenHash = hashPasswordRecoveryToken(args.rawToken);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<RecoveryRow>(
      `select id, user_id, consumed_at, expires_at
       from password_recovery_tokens
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
      row.expires_at instanceof Date
        ? row.expires_at.getTime()
        : Date.parse(String(row.expires_at));
    if (!Number.isFinite(expMs) || expMs <= nowMs) {
      await client.query("rollback");
      return { ok: false, reason: "expired" };
    }

    const { rows: userRows } = await client.query<{ account_status: string }>(
      `select account_status from users where id = $1::uuid for update`,
      [row.user_id],
    );
    const account = userRows[0];
    if (!account || account.account_status !== "active") {
      await client.query("rollback");
      return { ok: false, reason: "account_not_active" };
    }

    const value = await run(client, { userId: row.user_id });

    await client.query(
      `update password_recovery_tokens set consumed_at = now() where id = $1::uuid`,
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
