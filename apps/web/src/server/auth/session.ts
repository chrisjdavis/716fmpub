import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { Pool, PoolClient } from "pg";
import {
  AUTH_SESSION_COOKIE_NAME,
  isAccountRole,
  isProductPlan,
  type AccountRole,
  type ProductPlan,
} from "@vs/domain";
import type { ServerEnv } from "@vs/env";
import { isStrictDeployEnv, loadServerEnv } from "@vs/env";
import { hashSessionToken, newSessionToken } from "./session-token";

type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;

/**
 * Central session contract: absolute lifetime, idle cutoff, and API-only token rotation cadence.
 * All issuance, validation, and cookie serialization for `vs_session` live in this module.
 */
export const SESSION_POLICY = {
  /** Wall-clock cap from issuance (`sessions.expires_at`). */
  absoluteTtlMs: 30 * 24 * 60 * 60 * 1000,
  /** Inactivity window — `last_seen_at` must stay within this window of each validated request. */
  idleTimeoutMs: 7 * 24 * 60 * 60 * 1000,
  /** API routes may replace the opaque token on this wall-clock cadence (`sessions.last_rotated_at`). */
  rotationIntervalMs: 24 * 60 * 60 * 1000,
} as const;

export type SessionValidationMode = "rsc" | "api";

export type AuthenticatedUser = {
  id: string;
  email: string;
  /** From `users.email_verified_at` at session validation time (server source of truth). */
  emailVerified: boolean;
  /** From `users.account_role` at session validation time (server source of truth). */
  accountRole: AccountRole;
  /** From `users.product_plan` at session validation time (server source of truth). */
  productPlan: ProductPlan;
};

export async function readSessionRawToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(AUTH_SESSION_COOKIE_NAME)?.value;
}

export function isSessionCookieSecure(env: ServerEnv): boolean {
  if (env.NODE_ENV === "production") {
    return true;
  }
  return isStrictDeployEnv(env.deployEnv);
}

export function sessionCookieMaxAgeSec(): number {
  return Math.floor(SESSION_POLICY.absoluteTtlMs / 1000);
}

export function applySessionCookie(res: NextResponse, rawToken: string): void {
  const env = loadServerEnv();
  res.cookies.set({
    name: AUTH_SESSION_COOKIE_NAME,
    value: rawToken,
    httpOnly: true,
    sameSite: "lax",
    secure: isSessionCookieSecure(env),
    path: "/",
    maxAge: sessionCookieMaxAgeSec(),
  });
}

export function clearSessionCookie(res: NextResponse): void {
  const env = loadServerEnv();
  res.cookies.set({
    name: AUTH_SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: isSessionCookieSecure(env),
    path: "/",
    maxAge: 0,
  });
}

export async function createDbSession(
  pool: Db,
  userId: string,
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = newSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_POLICY.absoluteTtlMs);
  await pool.query(
    `insert into sessions (user_id, token_hash, expires_at, last_seen_at, last_rotated_at)
     values ($1::uuid, $2, $3::timestamptz, now(), now())`,
    [userId, tokenHash, expiresAt.toISOString()],
  );
  return { rawToken, expiresAt };
}

/**
 * Validates the opaque cookie token, enforces absolute + idle policy, touches `last_seen_at`,
 * and optionally rotates the stored hash (API mode only, so `Set-Cookie` can follow in a route handler).
 */
export async function validateSession(
  pool: Db,
  rawToken: string,
  mode: SessionValidationMode,
  nowMs: number = Date.now(),
): Promise<{ user: AuthenticatedUser; rotatedRawToken?: string } | null> {
  const tokenHash = hashSessionToken(rawToken);

  const { rows } = await pool.query<{
    id: string;
    user_id: string;
    email: string;
    email_verified_at: string | null;
    account_role: string;
    account_status: string;
    product_plan: string;
    last_rotated_at: string;
    expires_at: string;
    last_seen_at: string;
  }>(
    `select s.id, u.id as user_id, u.email, u.email_verified_at,
            u.account_role, u.account_status, u.product_plan,
            s.last_rotated_at, s.expires_at, s.last_seen_at
       from sessions s
       join users u on u.id = s.user_id
      where s.token_hash = $1`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }

  if (
    row.account_status !== "active" ||
    !isAccountRole(row.account_role) ||
    !isProductPlan(row.product_plan)
  ) {
    await pool.query(`delete from sessions where id = $1::uuid`, [row.id]);
    return null;
  }

  const expiresAtMs = new Date(row.expires_at).getTime();
  if (expiresAtMs <= nowMs) {
    return null;
  }
  const lastSeenMs = new Date(row.last_seen_at).getTime();
  if (lastSeenMs < nowMs - SESSION_POLICY.idleTimeoutMs) {
    return null;
  }

  const user: AuthenticatedUser = {
    id: row.user_id,
    email: row.email,
    emailVerified: row.email_verified_at != null,
    accountRole: row.account_role,
    productPlan: row.product_plan,
  };
  const lastRotatedMs = new Date(row.last_rotated_at).getTime();
  const rotationDue =
    mode === "api" &&
    nowMs - lastRotatedMs >= SESSION_POLICY.rotationIntervalMs;

  if (!rotationDue) {
    await pool.query(`update sessions set last_seen_at = now() where id = $1::uuid`, [
      row.id,
    ]);
    return { user };
  }

  const rotatedRaw = newSessionToken();
  const rotatedHash = hashSessionToken(rotatedRaw);
  await pool.query(
    `update sessions
        set token_hash = $2,
            last_seen_at = now(),
            last_rotated_at = now()
      where id = $1::uuid`,
    [row.id, rotatedHash],
  );
  return { user, rotatedRawToken: rotatedRaw };
}

export async function lookupUserIdBySessionRawToken(
  pool: Db,
  rawToken: string,
): Promise<string | null> {
  const tokenHash = hashSessionToken(rawToken);
  const { rows } = await pool.query<{ user_id: string }>(
    `select user_id from sessions where token_hash = $1 limit 1`,
    [tokenHash],
  );
  return rows[0]?.user_id ?? null;
}

/**
 * Deletes the session row for the raw cookie token and returns the owning user id when a row existed.
 */
export async function destroySessionByRawTokenReturningUserId(
  pool: Db,
  rawToken: string,
): Promise<string | null> {
  const tokenHash = hashSessionToken(rawToken);
  const { rows } = await pool.query<{ user_id: string }>(
    `delete from sessions where token_hash = $1 returning user_id`,
    [tokenHash],
  );
  return rows[0]?.user_id ?? null;
}

export async function destroySessionByRawToken(pool: Db, rawToken: string): Promise<void> {
  await destroySessionByRawTokenReturningUserId(pool, rawToken);
}

/**
 * Before issuing a new session after login, signup, or similar transitions:
 * removes the browser's current session row if any (mitigates session fixation),
 * then deletes all remaining rows for the authenticated user so superseded tokens cannot be reused.
 */
export async function invalidatePriorSessionsForAuthTransition(
  pool: Db,
  args: { userId: string; requestSessionRawToken?: string | undefined },
): Promise<void> {
  const trimmed = args.requestSessionRawToken?.trim();
  if (trimmed) {
    await destroySessionByRawToken(pool, trimmed);
  }
  await pool.query(`delete from sessions where user_id = $1::uuid`, [args.userId]);
}
