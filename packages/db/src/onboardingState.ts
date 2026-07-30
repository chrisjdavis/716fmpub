import type { Pool, PoolClient, QueryResultRow } from "pg";

import type { ImportJobRecord } from "./importJobs.js";
import { getLatestDashboardImportJobForUser } from "./importJobs.js";
import { tryInsertSecurityAuditEvent } from "./securityAuditEvents.js";
import { getUserListenStatsFoundationReadiness } from "./userListenStatsFoundationReadiness.js";

/** Values persisted on `users.onboarding_state` (CHECK constraint in migration). */
export const ONBOARDING_STATES = [
  "not_started",
  "intro",
  "connect_source",
  "configure_lastfm",
  "validating_lastfm",
  "ready_to_import",
  "import_started",
  "import_in_progress",
  "partial_ready",
  "completed",
] as const;

export type OnboardingState = (typeof ONBOARDING_STATES)[number];

const ONBOARDING_STATE_SET: ReadonlySet<string> = new Set(ONBOARDING_STATES);

export function parseOnboardingState(raw: unknown): OnboardingState | null {
  if (typeof raw !== "string") {
    return null;
  }
  return ONBOARDING_STATE_SET.has(raw) ? (raw as OnboardingState) : null;
}

/** Minimum listens to treat archive as partially usable during onboarding. */
export const ONBOARDING_MIN_LISTENS_PARTIAL_READY = 1 as const;

export type UserOnboardingRow = Readonly<{
  onboarding_state: OnboardingState;
  onboarding_dismissed_at: string | null;
  onboarding_completed_at: string | null;
  onboarding_context_json: Record<string, unknown> | null;
  onboarding_deferred_at: string | null;
}>;

type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;

function mapOnboardingRow(row: QueryResultRow): UserOnboardingRow {
  const state = parseOnboardingState(row["onboarding_state"]);
  if (state === null) {
    throw new Error(
      `Invalid onboarding_state "${String(row["onboarding_state"])}" for user`,
    );
  }
  const ctx = row["onboarding_context_json"];
  return {
    onboarding_state: state,
    onboarding_dismissed_at:
      row["onboarding_dismissed_at"] === null ||
      row["onboarding_dismissed_at"] === undefined
        ? null
        : String(row["onboarding_dismissed_at"]),
    onboarding_completed_at:
      row["onboarding_completed_at"] === null ||
      row["onboarding_completed_at"] === undefined
        ? null
        : String(row["onboarding_completed_at"]),
    onboarding_context_json:
      ctx !== null &&
      ctx !== undefined &&
      typeof ctx === "object" &&
      !Array.isArray(ctx)
        ? (ctx as Record<string, unknown>)
        : null,
    onboarding_deferred_at:
      row["onboarding_deferred_at"] === null ||
      row["onboarding_deferred_at"] === undefined
        ? null
        : String(row["onboarding_deferred_at"]),
  };
}

export async function getUserOnboardingRow(
  db: Db,
  userId: string,
): Promise<UserOnboardingRow | null> {
  const { rows } = await db.query(
    `select onboarding_state, onboarding_dismissed_at, onboarding_completed_at,
            onboarding_context_json, onboarding_deferred_at
     from users
     where id = $1::uuid
     limit 1`,
    [userId],
  );
  const row = rows[0];
  return row ? mapOnboardingRow(row as QueryResultRow) : null;
}

export async function countListensForUser(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query<{ c: string | number }>(
    `select count(*)::int as c from listens where user_id = $1::uuid`,
    [userId],
  );
  const n = Number(rows[0]?.["c"] ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * True when the latest user-sourced import job finished and downstream stats tables are populated
 * (or there are zero canonical listens after import, so rollups have nothing to build).
 */
export async function isOnboardingInitialImportProcessingComplete(
  db: Db,
  userId: string,
): Promise<boolean> {
  const job = await getLatestDashboardImportJobForUser(db, userId);
  if (!job || job.source !== "user" || job.stage !== "completed") {
    return false;
  }
  const listenCount = await countListensForUser(db, userId);
  if (listenCount === 0) {
    return true;
  }
  const r = await getUserListenStatsFoundationReadiness(db, userId);
  return (
    r.hasListens &&
    r.periodRollupsPopulated &&
    r.artistRollupsPopulated &&
    r.dailyMetricsPopulated
  );
}

/**
 * Applies import/listen-derived transitions: `import_in_progress` → `partial_ready`,
 * terminal import `completed` → onboarding `completed`.
 * No-op when already `completed` or still before import phases.
 */
export async function syncOnboardingProgressFromImports(
  db: Db,
  userId: string,
): Promise<UserOnboardingRow | null> {
  const before = await getUserOnboardingRow(db, userId);
  if (!before || before.onboarding_state === "completed") {
    return before;
  }

  const job = await getLatestDashboardImportJobForUser(db, userId);

  if (job?.source === "user" && job.stage === "failed") {
    if (
      before.onboarding_state === "import_started" ||
      before.onboarding_state === "import_in_progress" ||
      before.onboarding_state === "partial_ready"
    ) {
      await db.query(
        `update users
         set onboarding_state = 'ready_to_import',
             updated_at = now()
         where id = $1::uuid
           and onboarding_state in ('import_started', 'import_in_progress', 'partial_ready')`,
        [userId],
      );
    }
    return getUserOnboardingRow(db, userId);
  }

  const listenCount = await countListensForUser(db, userId);
  const hasPartialData =
    listenCount >= ONBOARDING_MIN_LISTENS_PARTIAL_READY ||
    (job !== null &&
      job.source === "user" &&
      (job.stage === "running" || job.stage === "queued") &&
      job.items_processed > 0);

  if (job?.source === "user" && job.stage === "completed") {
    const processingComplete = await isOnboardingInitialImportProcessingComplete(db, userId);
    if (processingComplete) {
      const { rowCount } = await db.query(
        `update users
         set onboarding_state = 'completed',
             onboarding_completed_at = coalesce(onboarding_completed_at, now()),
             updated_at = now()
         where id = $1::uuid
           and onboarding_state <> 'completed'`,
        [userId],
      );
      if ((rowCount ?? 0) > 0) {
        await tryInsertSecurityAuditEvent(db, {
          actorUserId: userId,
          action: "onboarding.complete",
          outcome: "success",
          metadata: { source: "auto_import_stats_ready" },
        });
      }
      return getUserOnboardingRow(db, userId);
    }
    await db.query(
      `update users
       set onboarding_state = 'partial_ready',
           updated_at = now()
       where id = $1::uuid
         and onboarding_state in ('import_started', 'import_in_progress')`,
      [userId],
    );
    return getUserOnboardingRow(db, userId);
  }

  if (
    job?.source === "user" &&
    (job.stage === "queued" || job.stage === "running") &&
    (before.onboarding_state === "ready_to_import" ||
      before.onboarding_state === "import_started")
  ) {
    await db.query(
      `update users
       set onboarding_state = 'import_in_progress',
           updated_at = now()
       where id = $1::uuid
         and onboarding_state in ('ready_to_import', 'import_started')`,
      [userId],
    );
  }

  const afterQueuedSync = await getUserOnboardingRow(db, userId);
  if (!afterQueuedSync) {
    return null;
  }

  if (
    hasPartialData &&
    (afterQueuedSync.onboarding_state === "import_started" ||
      afterQueuedSync.onboarding_state === "import_in_progress")
  ) {
    await db.query(
      `update users
       set onboarding_state = 'partial_ready',
           updated_at = now()
       where id = $1::uuid
         and onboarding_state in ('import_started', 'import_in_progress')`,
      [userId],
    );
    return getUserOnboardingRow(db, userId);
  }

  return getUserOnboardingRow(db, userId);
}

export async function updateUserOnboardingState(
  db: Db,
  userId: string,
  input: Readonly<{
    state: OnboardingState;
    contextPatch?: Record<string, unknown> | null;
    clearDeferred?: boolean;
  }>,
): Promise<void> {
  if (input.contextPatch !== undefined && input.contextPatch !== null) {
    await db.query(
      `update users
       set onboarding_state = $2::text,
           onboarding_context_json = coalesce(onboarding_context_json, '{}'::jsonb) || $3::jsonb,
           onboarding_deferred_at = case when $4::boolean then null else onboarding_deferred_at end,
           updated_at = now()
       where id = $1::uuid`,
      [
        userId,
        input.state,
        JSON.stringify(input.contextPatch),
        Boolean(input.clearDeferred),
      ],
    );
    return;
  }
  await db.query(
    `update users
     set onboarding_state = $2::text,
         onboarding_deferred_at = case when $3::boolean then null else onboarding_deferred_at end,
         updated_at = now()
     where id = $1::uuid`,
    [userId, input.state, Boolean(input.clearDeferred)],
  );
}

export async function setOnboardingDeferred(db: Db, userId: string): Promise<void> {
  await db.query(
    `update users
     set onboarding_deferred_at = now(),
         updated_at = now()
     where id = $1::uuid`,
    [userId],
  );
}

export async function markOnboardingCompleted(db: Db, userId: string): Promise<void> {
  await db.query(
    `update users
     set onboarding_state = 'completed',
         onboarding_completed_at = now(),
         onboarding_deferred_at = null,
         updated_at = now()
     where id = $1::uuid`,
    [userId],
  );
}

export type OnboardingGateDecision =
  | { kind: "require_onboarding"; row: UserOnboardingRow }
  | { kind: "allow_app"; row: UserOnboardingRow };

/**
 * Legacy dashboard gate helper: deferred users were allowed to browse the app without finishing
 * guided setup. The web app now enforces a stricter shell lock in `apps/web` instead of relying
 * on this alone.
 */
export function resolveOnboardingDashboardGate(
  row: UserOnboardingRow | null,
): OnboardingGateDecision {
  if (!row) {
    return {
      kind: "require_onboarding",
      row: {
        onboarding_state: "not_started",
        onboarding_dismissed_at: null,
        onboarding_completed_at: null,
        onboarding_context_json: null,
        onboarding_deferred_at: null,
      },
    };
  }
  if (
    row.onboarding_state === "completed" ||
    row.onboarding_completed_at !== null
  ) {
    return { kind: "allow_app", row };
  }
  if (row.onboarding_deferred_at !== null) {
    return { kind: "allow_app", row };
  }
  return { kind: "require_onboarding", row };
}

export function deriveImportStatusLabel(
  job: ImportJobRecord | null,
): "none" | "queued" | "running" | "completed" | "failed" | "idle" {
  if (!job || job.source !== "user") {
    return "none";
  }
  if (job.stage === "queued") {
    return "queued";
  }
  if (job.stage === "running") {
    return "running";
  }
  if (job.stage === "completed") {
    return "completed";
  }
  if (job.stage === "failed") {
    return "failed";
  }
  return "idle";
}
