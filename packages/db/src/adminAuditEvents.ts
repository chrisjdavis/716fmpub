import { summarizeThrowableForLog } from "@vs/sensitive";
import type { Pool, PoolClient } from "pg";

export const ADMIN_AUDIT_ACTIONS = [
  "admin.invite.created",
  "admin.invite.revoked",
  "admin.invite.accepted",
  "admin.user.account_role_changed",
  "admin.user.account_status_changed",
  "admin.user.account_role_change_denied",
  "admin.user.account_status_change_denied",
  "admin.user.product_plan_changed",
] as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

export const ADMIN_AUDIT_TARGET_TYPES = ["user", "invite"] as const;

export type AdminAuditTargetType = (typeof ADMIN_AUDIT_TARGET_TYPES)[number];

/**
 * Non-secret JSON context only (ids, prior/next enum values, counts).
 * Callers must not pass secrets, raw tokens, or bulk PII.
 */
export type AdminAuditPayload = Record<
  string,
  string | number | boolean | null | string[]
>;

type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export type AdminAuditEventRow = {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  action: AdminAuditAction;
  target_type: AdminAuditTargetType;
  target_id: string | null;
  payload: AdminAuditPayload;
};

/** Same row as persisted audit events plus joined actor email (null when no actor or user row missing). */
export type AdminAuditEventWithActorEmailRow = AdminAuditEventRow & {
  actor_email: string | null;
};

function isAdminAuditAction(value: string): value is AdminAuditAction {
  return (ADMIN_AUDIT_ACTIONS as readonly string[]).includes(value);
}

function isAdminAuditTargetType(value: string): value is AdminAuditTargetType {
  return (ADMIN_AUDIT_TARGET_TYPES as readonly string[]).includes(value);
}

export async function insertAdminAuditEvent(
  pool: Db,
  input: {
    actorUserId: string | null;
    action: AdminAuditAction;
    targetType: AdminAuditTargetType;
    targetId: string | null;
    payload?: AdminAuditPayload;
  },
): Promise<{ id: string }> {
  const payload = input.payload ?? {};
  const { rows } = await pool.query<{ id: string }>(
    `insert into admin_audit_events (actor_user_id, action, target_type, target_id, payload)
     values ($1::uuid, $2, $3, $4::uuid, $5::jsonb)
     returning id`,
    [input.actorUserId, input.action, input.targetType, input.targetId, JSON.stringify(payload)],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error("insertAdminAuditEvent: missing returning id");
  }
  return { id };
}

/**
 * Best-effort audit write for admin HTTP handlers: failures are logged and never thrown,
 * so a broken audit table cannot block the primary admin mutation path.
 */
export async function tryInsertAdminAuditEvent(
  pool: Db,
  input: {
    actorUserId: string | null;
    action: AdminAuditAction;
    targetType: AdminAuditTargetType;
    targetId: string | null;
    payload?: AdminAuditPayload;
  },
): Promise<void> {
  try {
    await insertAdminAuditEvent(pool, input);
  } catch (err) {
    console.error(
      JSON.stringify({
        vs: { kind: "admin_audit", v: 1 },
        ts: new Date().toISOString(),
        level: "error",
        event: "insert_failed",
        action: input.action,
        targetType: input.targetType,
        hasActor: Boolean(input.actorUserId),
        hasTargetId: Boolean(input.targetId),
        failure: summarizeThrowableForLog(err),
      }),
    );
  }
}

export async function listAdminAuditEvents(
  pool: Db,
  args: {
    actorUserId?: string | null;
    targetType?: AdminAuditTargetType;
    targetId?: string | null;
    limit: number;
  },
): Promise<AdminAuditEventRow[]> {
  const limit = Math.min(500, Math.max(1, Math.floor(args.limit)));
  const { rows } = await pool.query<{
    id: string;
    occurred_at: string;
    actor_user_id: string | null;
    action: string;
    target_type: string;
    target_id: string | null;
    payload: unknown;
  }>(
    `select id, occurred_at, actor_user_id, action, target_type, target_id, payload
       from admin_audit_events
      where ($1::uuid is null or actor_user_id = $1::uuid)
        and ($2::text is null or target_type = $2::text)
        and ($3::uuid is null or target_id = $3::uuid)
   order by occurred_at desc, id desc
      limit $4::int`,
    [args.actorUserId ?? null, args.targetType ?? null, args.targetId ?? null, limit],
  );
  const out: AdminAuditEventRow[] = [];
  for (const row of rows) {
    if (!isAdminAuditAction(row.action) || !isAdminAuditTargetType(row.target_type)) {
      console.error(
        JSON.stringify({
          vs: { kind: "admin_audit", v: 1 },
          ts: new Date().toISOString(),
          level: "warn",
          event: "list_row_invalid_contract",
          id: row.id,
          action: row.action,
          target_type: row.target_type,
        }),
      );
      continue;
    }
    const payload =
      row.payload !== null && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as AdminAuditPayload)
        : {};
    out.push({
      id: row.id,
      occurred_at: row.occurred_at,
      actor_user_id: row.actor_user_id,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      payload,
    });
  }
  return out;
}

/**
 * Recent admin audit rows with `users.email` for the actor when present.
 * Uses the same filters and contract validation as {@link listAdminAuditEvents}.
 */
export async function listAdminAuditEventsWithActorEmail(
  pool: Db,
  args: {
    actorUserId?: string | null;
    targetType?: AdminAuditTargetType;
    targetId?: string | null;
    limit: number;
  },
): Promise<AdminAuditEventWithActorEmailRow[]> {
  const limit = Math.min(500, Math.max(1, Math.floor(args.limit)));
  const { rows } = await pool.query<{
    id: string;
    occurred_at: string;
    actor_user_id: string | null;
    action: string;
    target_type: string;
    target_id: string | null;
    payload: unknown;
    actor_email: string | null;
  }>(
    `select e.id, e.occurred_at, e.actor_user_id, e.action, e.target_type, e.target_id, e.payload,
            u.email as actor_email
       from admin_audit_events e
  left join users u on u.id = e.actor_user_id
      where ($1::uuid is null or e.actor_user_id = $1::uuid)
        and ($2::text is null or e.target_type = $2::text)
        and ($3::uuid is null or e.target_id = $3::uuid)
   order by e.occurred_at desc, e.id desc
      limit $4::int`,
    [args.actorUserId ?? null, args.targetType ?? null, args.targetId ?? null, limit],
  );
  const out: AdminAuditEventWithActorEmailRow[] = [];
  for (const row of rows) {
    if (!isAdminAuditAction(row.action) || !isAdminAuditTargetType(row.target_type)) {
      console.error(
        JSON.stringify({
          vs: { kind: "admin_audit", v: 1 },
          ts: new Date().toISOString(),
          level: "warn",
          event: "list_with_actor_row_invalid_contract",
          id: row.id,
          action: row.action,
          target_type: row.target_type,
        }),
      );
      continue;
    }
    const payload =
      row.payload !== null && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as AdminAuditPayload)
        : {};
    out.push({
      id: row.id,
      occurred_at: row.occurred_at,
      actor_user_id: row.actor_user_id,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      payload,
      actor_email: row.actor_email,
    });
  }
  return out;
}
