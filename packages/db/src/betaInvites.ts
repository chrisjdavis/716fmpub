import { createHash, randomBytes } from "node:crypto";
import {
  canonicalizeAccountEmail,
  resolveBetaInviteLifecycleState,
} from "@vs/domain";
import type { BetaInviteLifecycleState } from "@vs/domain";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { isPostgresUniqueViolation } from "./postgresErrors.js";
import { pgTimestamptzToIsoOrNull, pgTimestamptzToIsoString } from "./pgTimestamptz.js";

type PoolWithConnect = Pick<Pool, "connect">;

export type BetaInviteDbExecutor =
  | Pick<Pool, "query">
  | Pick<PoolClient, "query">;

export type BetaInviteRecord = Readonly<{
  id: string;
  token_hash: string;
  locked_email: string | null;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}>;

export type BetaInviteRedemptionRecord = Readonly<{
  id: string;
  invite_id: string;
  redeemed_user_id: string;
  redeemed_at: string;
}>;

export type BetaInviteIssue = Readonly<{
  rawToken: string;
  invite: BetaInviteRecord;
}>;

export type RedeemBetaInviteFailure =
  | "invalid_token"
  | "expired"
  | "revoked"
  | "exhausted"
  | "email_lock_mismatch"
  | "already_redeemed";

const BETA_INVITE_ROW_SELECT = [
  "id",
  "token_hash",
  "locked_email",
  "max_uses",
  "used_count",
  "expires_at",
  "revoked_at",
  "revoked_reason",
  "created_by_user_id",
  "created_at",
  "updated_at",
].join(", ");

function hashBetaInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function newRawBetaInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

function mapBetaInviteRow(row: QueryResultRow): BetaInviteRecord {
  return {
    id: String(row["id"]),
    token_hash: String(row["token_hash"]),
    locked_email:
      row["locked_email"] === null || row["locked_email"] === undefined
        ? null
        : String(row["locked_email"]),
    max_uses: Number(row["max_uses"]),
    used_count: Number(row["used_count"]),
    expires_at: pgTimestamptzToIsoOrNull(row["expires_at"]),
    revoked_at: pgTimestamptzToIsoOrNull(row["revoked_at"]),
    revoked_reason:
      row["revoked_reason"] === null || row["revoked_reason"] === undefined
        ? null
        : String(row["revoked_reason"]),
    created_by_user_id: String(row["created_by_user_id"]),
    created_at: pgTimestamptzToIsoString(row["created_at"]),
    updated_at: pgTimestamptzToIsoString(row["updated_at"]),
  };
}

function mapRedemptionRow(row: QueryResultRow): BetaInviteRedemptionRecord {
  return {
    id: String(row["id"]),
    invite_id: String(row["invite_id"]),
    redeemed_user_id: String(row["redeemed_user_id"]),
    redeemed_at: pgTimestamptzToIsoString(row["redeemed_at"]),
  };
}

/**
 * SQL lifecycle filters must stay aligned with {@link resolveBetaInviteLifecycleState}
 * ordering (`revoked` → `expired` → `exhausted` → `active`).
 */
function lifecycleWhereSql(
  lifecycle: BetaInviteLifecycleState,
  nowParam: string,
): string {
  switch (lifecycle) {
    case "revoked":
      return `revoked_at is not null`;
    case "expired":
      return `revoked_at is null and expires_at is not null and expires_at <= ${nowParam}::timestamptz`;
    case "exhausted":
      return `revoked_at is null and (expires_at is null or expires_at > ${nowParam}::timestamptz) and used_count >= max_uses`;
    case "active":
      return `revoked_at is null and (expires_at is null or expires_at > ${nowParam}::timestamptz) and used_count < max_uses`;
    default: {
      const _exhaustive: never = lifecycle;
      return _exhaustive;
    }
  }
}

export function betaInviteLifecycleStateFromRecord(
  invite: BetaInviteRecord,
  nowMs: number = Date.now(),
): BetaInviteLifecycleState {
  return resolveBetaInviteLifecycleState({
    revokedAt: invite.revoked_at,
    expiresAt: invite.expires_at,
    usedCount: invite.used_count,
    maxUses: invite.max_uses,
    nowMs,
  });
}

export async function insertBetaInvite(
  pool: BetaInviteDbExecutor,
  args: Readonly<{
    createdByUserId: string;
    maxUses: number;
    lockedEmail?: string | null;
    expiresAt?: Date | null;
  }>,
): Promise<BetaInviteIssue> {
  if (!Number.isInteger(args.maxUses) || args.maxUses < 1) {
    throw new Error("insertBetaInvite: maxUses must be a positive integer");
  }
  const rawToken = newRawBetaInviteToken();
  const tokenHash = hashBetaInviteToken(rawToken);
  const locked =
    args.lockedEmail === undefined || args.lockedEmail === null
      ? null
      : canonicalizeAccountEmail(args.lockedEmail);
  const expiresIso =
    args.expiresAt === undefined || args.expiresAt === null
      ? null
      : args.expiresAt.toISOString();
  const { rows } = await pool.query<QueryResultRow>(
    `insert into beta_invites (
       token_hash,
       locked_email,
       max_uses,
       used_count,
       expires_at,
       created_by_user_id
     ) values ($1, $2, $3::int, 0, $4::timestamptz, $5::uuid)
     returning ${BETA_INVITE_ROW_SELECT}`,
    [tokenHash, locked, args.maxUses, expiresIso, args.createdByUserId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("insertBetaInvite: missing returning row");
  }
  return { rawToken, invite: mapBetaInviteRow(row) };
}

export async function getBetaInviteByIdForCreator(
  pool: BetaInviteDbExecutor,
  args: Readonly<{
    inviteId: string;
    createdByUserId: string;
  }>,
): Promise<BetaInviteRecord | null> {
  const { rows } = await pool.query<QueryResultRow>(
    `select ${BETA_INVITE_ROW_SELECT}
     from beta_invites
     where id = $1::uuid and created_by_user_id = $2::uuid`,
    [args.inviteId, args.createdByUserId],
  );
  const row = rows[0];
  return row ? mapBetaInviteRow(row) : null;
}

export async function getBetaInviteByTokenHash(
  pool: BetaInviteDbExecutor,
  tokenHash: string,
): Promise<BetaInviteRecord | null> {
  const { rows } = await pool.query<QueryResultRow>(
    `select ${BETA_INVITE_ROW_SELECT}
     from beta_invites
     where token_hash = $1`,
    [tokenHash],
  );
  const row = rows[0];
  return row ? mapBetaInviteRow(row) : null;
}

export type ListBetaInvitesForCreatorArgs = Readonly<{
  createdByUserId: string;
  lifecycle?: BetaInviteLifecycleState;
  nowMs?: number;
  limit?: number;
}>;

export async function listBetaInvitesForCreator(
  pool: BetaInviteDbExecutor,
  args: ListBetaInvitesForCreatorArgs,
): Promise<BetaInviteRecord[]> {
  const nowMs = args.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const limit =
    args.limit === undefined ? 200 : Math.min(500, Math.max(1, args.limit));
  const lifecycle = args.lifecycle;
  const whereLifecycle =
    lifecycle === undefined
      ? ""
      : ` and (${lifecycleWhereSql(lifecycle, "$2")})`;
  const params: unknown[] = [args.createdByUserId];
  if (lifecycle !== undefined) {
    params.push(nowIso);
  }
  params.push(limit);
  const limitParam = lifecycle === undefined ? "$2" : "$3";
  const { rows } = await pool.query<QueryResultRow>(
    `select ${BETA_INVITE_ROW_SELECT}
     from beta_invites
     where created_by_user_id = $1::uuid${whereLifecycle}
     order by created_at desc, id desc
     limit ${limitParam}::int`,
    params,
  );
  return rows.map((r) => mapBetaInviteRow(r));
}

export type ListBetaInvitesByLifecycleArgs = Readonly<{
  lifecycle: BetaInviteLifecycleState;
  nowMs?: number;
  limit?: number;
}>;

export async function listBetaInvitesByLifecycleState(
  pool: BetaInviteDbExecutor,
  args: ListBetaInvitesByLifecycleArgs,
): Promise<BetaInviteRecord[]> {
  const nowMs = args.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const limit =
    args.limit === undefined ? 200 : Math.min(500, Math.max(1, args.limit));
  const { rows } = await pool.query<QueryResultRow>(
    `select ${BETA_INVITE_ROW_SELECT}
     from beta_invites
     where ${lifecycleWhereSql(args.lifecycle, "$1")}
     order by created_at desc, id desc
     limit $2::int`,
    [nowIso, limit],
  );
  return rows.map((r) => mapBetaInviteRow(r));
}

export async function getBetaInviteById(
  pool: BetaInviteDbExecutor,
  args: Readonly<{ inviteId: string }>,
): Promise<BetaInviteRecord | null> {
  const { rows } = await pool.query<QueryResultRow>(
    `select ${BETA_INVITE_ROW_SELECT}
     from beta_invites
     where id = $1::uuid`,
    [args.inviteId],
  );
  const row = rows[0];
  return row ? mapBetaInviteRow(row) : null;
}

export type ListBetaInvitesForAdminArgs = Readonly<{
  lifecycle?: BetaInviteLifecycleState;
  nowMs?: number;
  limit?: number;
}>;

/**
 * Staff-scoped listing (no `created_by_user_id` filter). When `lifecycle` is omitted,
 * returns the newest invites across all creators.
 */
export async function listBetaInvitesForAdmin(
  pool: BetaInviteDbExecutor,
  args: ListBetaInvitesForAdminArgs,
): Promise<BetaInviteRecord[]> {
  const nowMs = args.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const limit =
    args.limit === undefined ? 200 : Math.min(500, Math.max(1, args.limit));
  const lifecycle = args.lifecycle;
  if (lifecycle === undefined) {
    const { rows } = await pool.query<QueryResultRow>(
      `select ${BETA_INVITE_ROW_SELECT}
       from beta_invites
       order by created_at desc, id desc
       limit $1::int`,
      [limit],
    );
    return rows.map((r) => mapBetaInviteRow(r));
  }
  const { rows } = await pool.query<QueryResultRow>(
    `select ${BETA_INVITE_ROW_SELECT}
     from beta_invites
     where ${lifecycleWhereSql(lifecycle, "$1")}
     order by created_at desc, id desc
     limit $2::int`,
    [nowIso, limit],
  );
  return rows.map((r) => mapBetaInviteRow(r));
}

/**
 * Revokes by primary key only (staff path). Returns null when the row is missing or
 * already revoked.
 */
export async function revokeBetaInviteForAdmin(
  pool: BetaInviteDbExecutor,
  args: Readonly<{
    inviteId: string;
    reason?: string | null;
  }>,
): Promise<BetaInviteRecord | null> {
  const { rows } = await pool.query<QueryResultRow>(
    `update beta_invites
     set revoked_at = now(),
         revoked_reason = $2,
         updated_at = now()
     where id = $1::uuid
       and revoked_at is null
     returning ${BETA_INVITE_ROW_SELECT}`,
    [args.inviteId, args.reason ?? null],
  );
  const row = rows[0];
  return row ? mapBetaInviteRow(row) : null;
}

export async function revokeBetaInvite(
  pool: BetaInviteDbExecutor,
  args: Readonly<{
    inviteId: string;
    createdByUserId: string;
    reason?: string | null;
  }>,
): Promise<BetaInviteRecord | null> {
  const { rows } = await pool.query<QueryResultRow>(
    `update beta_invites
     set revoked_at = now(),
         revoked_reason = $3,
         updated_at = now()
     where id = $1::uuid
       and created_by_user_id = $2::uuid
       and revoked_at is null
     returning ${BETA_INVITE_ROW_SELECT}`,
    [args.inviteId, args.createdByUserId, args.reason ?? null],
  );
  const row = rows[0];
  return row ? mapBetaInviteRow(row) : null;
}

type PoolClientQuery = Pick<PoolClient, "query">;

async function selectInviteForUpdateByRawToken(
  client: PoolClientQuery,
  rawToken: string,
): Promise<BetaInviteRecord | null> {
  const tokenHash = hashBetaInviteToken(rawToken);
  const { rows } = await client.query<QueryResultRow>(
    `select ${BETA_INVITE_ROW_SELECT}
     from beta_invites
     where token_hash = $1
     for update`,
    [tokenHash],
  );
  const row = rows[0];
  return row ? mapBetaInviteRow(row) : null;
}

function gateInviteForRedemption(
  invite: BetaInviteRecord,
  redeemerEmail: string,
  nowMs: number,
): { ok: true } | { ok: false; reason: RedeemBetaInviteFailure } {
  const lifecycle = betaInviteLifecycleStateFromRecord(invite, nowMs);
  if (lifecycle === "revoked") {
    return { ok: false, reason: "revoked" };
  }
  if (lifecycle === "expired") {
    return { ok: false, reason: "expired" };
  }
  if (lifecycle === "exhausted") {
    return { ok: false, reason: "exhausted" };
  }
  if (invite.locked_email !== null && invite.locked_email !== redeemerEmail) {
    return { ok: false, reason: "email_lock_mismatch" };
  }
  return { ok: true };
}

async function completeBetaInviteRedemptionOnClient(
  client: PoolClientQuery,
  invite: BetaInviteRecord,
  redeemerUserId: string,
): Promise<
  | { ok: true; invite: BetaInviteRecord; redemption: BetaInviteRedemptionRecord }
  | { ok: false; reason: "already_redeemed" | "exhausted" }
> {
  const dup = await client.query<{ n: string }>(
    `select 1 as n
     from beta_invite_redemptions
     where invite_id = $1::uuid and redeemed_user_id = $2::uuid`,
    [invite.id, redeemerUserId],
  );
  if (dup.rows[0]) {
    return { ok: false, reason: "already_redeemed" };
  }

  let redemptionRow: QueryResultRow | undefined;
  try {
    const ins = await client.query<QueryResultRow>(
      `insert into beta_invite_redemptions (invite_id, redeemed_user_id)
       values ($1::uuid, $2::uuid)
       returning id, invite_id, redeemed_user_id, redeemed_at`,
      [invite.id, redeemerUserId],
    );
    redemptionRow = ins.rows[0];
  } catch (err) {
    if (isPostgresUniqueViolation(err)) {
      return { ok: false, reason: "already_redeemed" };
    }
    throw err;
  }
  if (!redemptionRow) {
    return { ok: false, reason: "exhausted" };
  }

  const upd = await client.query<QueryResultRow>(
    `update beta_invites
     set used_count = used_count + 1,
         updated_at = now()
     where id = $1::uuid
       and used_count < max_uses
     returning ${BETA_INVITE_ROW_SELECT}`,
    [invite.id],
  );
  const updated = upd.rows[0];
  if (!updated) {
    return { ok: false, reason: "exhausted" };
  }

  return {
    ok: true,
    invite: mapBetaInviteRow(updated),
    redemption: mapRedemptionRow(redemptionRow),
  };
}

/**
 * Creates a user row and consumes one invite use in the **caller's** transaction.
 * Caller must `BEGIN` on `client` first and `COMMIT` or `ROLLBACK` after this returns.
 */
export async function insertUserWithBetaInviteRedemption(
  client: PoolClient,
  args: Readonly<{
    canonicalEmail: string;
    passwordHash: string;
    rawInviteToken: string;
    nowMs?: number;
  }>,
): Promise<
  | { ok: true; userId: string; signupBetaInviteId: string }
  | { ok: false; reason: RedeemBetaInviteFailure }
> {
  const nowMs = args.nowMs ?? Date.now();
  const redeemerEmail = canonicalizeAccountEmail(args.canonicalEmail);
  const inviteRow = await selectInviteForUpdateByRawToken(client, args.rawInviteToken);
  if (!inviteRow) {
    return { ok: false, reason: "invalid_token" };
  }
  const gated = gateInviteForRedemption(inviteRow, redeemerEmail, nowMs);
  if (!gated.ok) {
    return { ok: false, reason: gated.reason };
  }

  const { rows: userRows } = await client.query<{ id: string }>(
    `insert into users (email, password_hash, signup_beta_invite_id)
     values ($1, $2, $3::uuid)
     returning id`,
    [redeemerEmail, args.passwordHash, inviteRow.id],
  );
  const userRow = userRows[0];
  if (!userRow) {
    throw new Error("insertUserWithBetaInviteRedemption: user insert returned no row");
  }

  const done = await completeBetaInviteRedemptionOnClient(client, inviteRow, userRow.id);
  if (!done.ok) {
    throw new Error(
      `insertUserWithBetaInviteRedemption: redemption failed after user insert (${done.reason})`,
    );
  }

  return {
    ok: true,
    userId: userRow.id,
    signupBetaInviteId: inviteRow.id,
  };
}

export async function tryRedeemBetaInvite(
  pool: PoolWithConnect,
  args: Readonly<{
    rawToken: string;
    redeemerUserId: string;
    redeemerEmail: string;
    nowMs?: number;
  }>,
): Promise<
  | { ok: true; invite: BetaInviteRecord; redemption: BetaInviteRedemptionRecord }
  | { ok: false; reason: RedeemBetaInviteFailure }
> {
  const nowMs = args.nowMs ?? Date.now();
  const redeemerEmail = canonicalizeAccountEmail(args.redeemerEmail);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const inviteRow = await selectInviteForUpdateByRawToken(client, args.rawToken);
    if (!inviteRow) {
      await client.query("rollback");
      return { ok: false, reason: "invalid_token" };
    }
    const gated = gateInviteForRedemption(inviteRow, redeemerEmail, nowMs);
    if (!gated.ok) {
      await client.query("rollback");
      return { ok: false, reason: gated.reason };
    }

    const done = await completeBetaInviteRedemptionOnClient(
      client,
      inviteRow,
      args.redeemerUserId,
    );
    if (!done.ok) {
      await client.query("rollback");
      return { ok: false, reason: done.reason };
    }

    await client.query("commit");
    return done;
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

export function hashBetaInviteTokenForLookup(rawToken: string): string {
  return hashBetaInviteToken(rawToken);
}
