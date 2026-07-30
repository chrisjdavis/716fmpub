import { summarizeThrowableForLog } from "@vs/sensitive";
import type { Pool, PoolClient } from "pg";

export const SECURITY_AUDIT_ACTIONS = [
  "auth.login",
  "auth.logout",
  "export.generate",
  "account.delete_attempt",
  "account.delete_complete",
  "account.settings_patch",
  "account.email_change_request",
  "account.email_change_complete",
  "import.trigger",
  "listen_data.deletion_attempt",
  "listen_data.deletion_complete",
  "onboarding.lastfm_configure",
  "onboarding.lastfm_validate",
  "onboarding.defer",
  "onboarding.complete",
  "onboarding.import_start",
] as const;

export type SecurityAuditAction = (typeof SECURITY_AUDIT_ACTIONS)[number];

export const SECURITY_AUDIT_OUTCOMES = ["success", "failure", "denied"] as const;

export type SecurityAuditOutcome = (typeof SECURITY_AUDIT_OUTCOMES)[number];

/**
 * Non-secret JSON context only (ids, codes, counts, booleans).
 * Callers must not pass raw passwords, API keys, tokens, or PII beyond UUIDs already used as actor_user_id.
 */
export type SecurityAuditMetadata = Record<
  string,
  string | number | boolean | null | string[]
>;

type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export type SecurityAuditEventRow = {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  action: SecurityAuditAction;
  outcome: SecurityAuditOutcome;
  metadata: SecurityAuditMetadata;
};

function isAuditAction(value: string): value is SecurityAuditAction {
  return (SECURITY_AUDIT_ACTIONS as readonly string[]).includes(value);
}

function isAuditOutcome(value: string): value is SecurityAuditOutcome {
  return (SECURITY_AUDIT_OUTCOMES as readonly string[]).includes(value);
}

export async function insertSecurityAuditEvent(
  pool: Db,
  input: {
    actorUserId: string | null;
    action: SecurityAuditAction;
    outcome: SecurityAuditOutcome;
    metadata?: SecurityAuditMetadata;
  },
): Promise<{ id: string }> {
  const metadata = input.metadata ?? {};
  const { rows } = await pool.query<{ id: string }>(
    `insert into security_audit_events (actor_user_id, action, outcome, metadata)
     values ($1::uuid, $2, $3, $4::jsonb)
     returning id`,
    [input.actorUserId, input.action, input.outcome, JSON.stringify(metadata)],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error("insertSecurityAuditEvent: missing returning id");
  }
  return { id };
}

/**
 * Best-effort audit write for HTTP handlers: failures are logged and never thrown,
 * so a broken audit table cannot block primary user flows.
 */
export async function tryInsertSecurityAuditEvent(
  pool: Db,
  input: {
    actorUserId: string | null;
    action: SecurityAuditAction;
    outcome: SecurityAuditOutcome;
    metadata?: SecurityAuditMetadata;
  },
): Promise<void> {
  try {
    await insertSecurityAuditEvent(pool, input);
  } catch (err) {
    console.error(
      JSON.stringify({
        vs: { kind: "security_audit", v: 1 },
        ts: new Date().toISOString(),
        level: "error",
        event: "insert_failed",
        action: input.action,
        outcome: input.outcome,
        hasActor: Boolean(input.actorUserId),
        failure: summarizeThrowableForLog(err),
      }),
    );
  }
}

export async function listSecurityAuditEvents(
  pool: Db,
  args: { actorUserId?: string | null; limit: number },
): Promise<SecurityAuditEventRow[]> {
  const limit = Math.min(500, Math.max(1, Math.floor(args.limit)));
  const { rows } = await pool.query<{
    id: string;
    occurred_at: string;
    actor_user_id: string | null;
    action: string;
    outcome: string;
    metadata: unknown;
  }>(
    `select id, occurred_at, actor_user_id, action, outcome, metadata
       from security_audit_events
      where ($1::uuid is null or actor_user_id = $1::uuid)
   order by occurred_at desc, id desc
      limit $2::int`,
    [args.actorUserId ?? null, limit],
  );
  const out: SecurityAuditEventRow[] = [];
  for (const row of rows) {
    if (!isAuditAction(row.action) || !isAuditOutcome(row.outcome)) {
      console.error(
        JSON.stringify({
          vs: { kind: "security_audit", v: 1 },
          ts: new Date().toISOString(),
          level: "warn",
          event: "list_row_invalid_contract",
          id: row.id,
          action: row.action,
          outcome: row.outcome,
        }),
      );
      continue;
    }
    const meta =
      row.metadata !== null && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as SecurityAuditMetadata)
        : {};
    out.push({
      id: row.id,
      occurred_at: row.occurred_at,
      actor_user_id: row.actor_user_id,
      action: row.action,
      outcome: row.outcome,
      metadata: meta,
    });
  }
  return out;
}
