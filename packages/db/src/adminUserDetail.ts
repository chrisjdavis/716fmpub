import type { Pool, QueryResultRow } from "pg";

import {
  formatLayer1SignalVersionFromEvidenceColumns,
  LAYER1_ACTIVE_SIGNAL_VERSION,
  parseProductPlan,
} from "@vs/domain";

import { getLatestDashboardImportJobForUser } from "./importJobs.js";
import type { ImportJobRecord } from "./importJobs.js";
import {
  deriveImportStatusLabel,
  parseOnboardingState,
  type OnboardingState,
} from "./onboardingState.js";
import { pgTimestamptzToIsoOrNull, pgTimestamptzToIsoString } from "./pgTimestamptz.js";

import type { AdminUserListRecord } from "./adminUsersList.js";
import {
  getLayer1UserRecomputeStateRow,
  queryLayer1InputWatermarkForUser,
  resolveLayer1UserRecomputeEffectiveStatus,
  type Layer1UserRecomputePersistedStatus,
} from "./layer1UserRecomputeState.js";

type Db = Pick<Pool, "query">;

export type AdminUserDetailListeningProductTier = "core" | "advanced" | "unknown";

export type AdminUserDetailLayer1ManualRecomputeGate = Readonly<{
  eligible: boolean;
  /** When `eligible` is false, a stable machine reason for operators. */
  ineligibleReason: "advanced_plan_required" | "unknown_product_plan" | null;
}>;

/** How `AdminUserDetailLayer1Summary.lastMaterializedSignalVersion` was derived. */
export type AdminUserDetailLayer1MaterializedVersionProvenance =
  | "none"
  | "latest_layer1_evidence_object_by_created_at";

/** Staff-only Layer 1 diagnostics (server-sourced; no client inference). */
export type AdminUserDetailLayer1Summary = Readonly<{
  listeningProductTier: AdminUserDetailListeningProductTier;
  activeSignalVersion: string;
  /**
   * Composite signal version from the newest `layer1_evidence_objects` row for this user
   * (`order by created_at desc limit 1`), or null when no evidence rows exist.
   */
  lastMaterializedSignalVersion: string | null;
  /** Explicit provenance for `lastMaterializedSignalVersion` (never inferred client-side). */
  lastMaterializedSignalVersionProvenance: AdminUserDetailLayer1MaterializedVersionProvenance;
  persistedRecomputeStatus: Layer1UserRecomputePersistedStatus | "absent";
  effectiveStatus: Layer1UserRecomputePersistedStatus;
  persistedSignalVersion: string | null;
  inputWatermarkAt: string | null;
  lastEnqueuedAt: string | null;
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  consecutiveFailureCount: number;
  manualRecompute: AdminUserDetailLayer1ManualRecomputeGate;
}>;

/** Signup invite row joined for admin detail (no token material). */
export type AdminUserDetailInviteProvenance = Readonly<{
  id: string;
  lockedEmail: string | null;
  createdAt: string | null;
  createdByUserId: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  /** When this user redeemed the invite, if recorded. */
  redeemedAt: string | null;
}>;

export type AdminUserDetailOnboardingSummary = Readonly<{
  state: OnboardingState;
  dismissedAt: string | null;
  completedAt: string | null;
  deferredAt: string | null;
  importReadyEmailSentAt: string | null;
}>;

export type AdminUserDetailImportSummary = Readonly<{
  totalJobCount: number;
  activeJobCount: number;
  listenCount: number;
  latestUserJob: ImportJobRecord | null;
  latestUserImportStatus: ReturnType<typeof deriveImportStatusLabel>;
}>;

/** Staff-only read model for a single user (no password or invite token hashes). */
export type AdminUserDetailRecord = Readonly<{
  user: AdminUserListRecord;
  account: Readonly<{
    updatedAt: string;
    emailVerifiedAt: string | null;
    statsTimezone: string | null;
    welcomeEmailSentAt: string | null;
  }>;
  signupBetaInvite: AdminUserDetailInviteProvenance | null;
  onboarding: AdminUserDetailOnboardingSummary;
  importSummary: AdminUserDetailImportSummary;
  layer1: AdminUserDetailLayer1Summary;
}>;

function mapListRecordFromCoreRow(row: QueryResultRow): AdminUserListRecord {
  return {
    id: String(row["id"]),
    email: String(row["email"]),
    display_name:
      row["display_name"] === null || row["display_name"] === undefined
        ? null
        : String(row["display_name"]),
    lastfm_username:
      row["lastfm_username"] === null || row["lastfm_username"] === undefined
        ? null
        : String(row["lastfm_username"]),
    account_role: String(row["account_role"]),
    account_status: String(row["account_status"]),
    product_plan: String(row["product_plan"]),
    created_at: pgTimestamptzToIsoString(row["created_at"]),
    signup_beta_invite_id:
      row["signup_beta_invite_id"] === null ||
      row["signup_beta_invite_id"] === undefined
        ? null
        : String(row["signup_beta_invite_id"]),
    invite_locked_email:
      row["invite_locked_email"] === null ||
      row["invite_locked_email"] === undefined
        ? null
        : String(row["invite_locked_email"]),
    invite_created_at:
      row["invite_created_at"] === null || row["invite_created_at"] === undefined
        ? null
        : pgTimestamptzToIsoString(row["invite_created_at"]),
    invite_created_by_user_id:
      row["invite_created_by_user_id"] === null ||
      row["invite_created_by_user_id"] === undefined
        ? null
        : String(row["invite_created_by_user_id"]),
  };
}

function numOrZero(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function dateToIsoOrNull(d: Date | null): string | null {
  return d == null ? null : d.toISOString();
}

async function queryLatestLayer1MaterializedSignalVersionString(
  db: Db,
  userId: string,
): Promise<string | null> {
  const { rows } = await db.query<QueryResultRow>(
    `select signal_kind,
            signal_definition_version,
            evidence_schema_version
       from layer1_evidence_objects
      where user_id = $1::uuid
      order by created_at desc
      limit 1`,
    [userId],
  );
  const r = rows[0];
  if (!r) {
    return null;
  }
  const esc = r["evidence_schema_version"];
  const ev = typeof esc === "number" ? esc : Number.parseInt(String(esc), 10);
  if (!Number.isFinite(ev)) {
    return null;
  }
  return formatLayer1SignalVersionFromEvidenceColumns({
    signalKind: String(r["signal_kind"]),
    signalDefinitionVersion: String(r["signal_definition_version"]),
    evidenceSchemaVersion: ev,
  });
}

function buildAdminLayer1Summary(input: Readonly<{
  productPlanRaw: string;
  layer1Row: Awaited<ReturnType<typeof getLayer1UserRecomputeStateRow>>;
  currentInputWatermark: Date | null;
  lastMaterializedSignalVersion: string | null;
}>): AdminUserDetailLayer1Summary {
  const plan = parseProductPlan(input.productPlanRaw);
  const listeningProductTier: AdminUserDetailListeningProductTier =
    plan === "advanced" ? "advanced" : plan === "core" ? "core" : "unknown";
  const row = input.layer1Row;
  const persistedRecomputeStatus: Layer1UserRecomputePersistedStatus | "absent" =
    row == null ? "absent" : row.status;
  const effectiveStatus = resolveLayer1UserRecomputeEffectiveStatus(row, {
    currentInputWatermark: input.currentInputWatermark,
  });
  const manualRecompute: AdminUserDetailLayer1ManualRecomputeGate =
    listeningProductTier === "advanced"
      ? { eligible: true, ineligibleReason: null }
      : listeningProductTier === "core"
        ? { eligible: false, ineligibleReason: "advanced_plan_required" }
        : { eligible: false, ineligibleReason: "unknown_product_plan" };

  const lastMaterializedSignalVersion = input.lastMaterializedSignalVersion;
  const lastMaterializedSignalVersionProvenance: AdminUserDetailLayer1MaterializedVersionProvenance =
    lastMaterializedSignalVersion == null ? "none" : "latest_layer1_evidence_object_by_created_at";

  return {
    listeningProductTier,
    activeSignalVersion: LAYER1_ACTIVE_SIGNAL_VERSION,
    lastMaterializedSignalVersion,
    lastMaterializedSignalVersionProvenance,
    persistedRecomputeStatus,
    effectiveStatus,
    persistedSignalVersion: row == null ? null : row.signalVersion,
    inputWatermarkAt: dateToIsoOrNull(row?.inputWatermark ?? null),
    lastEnqueuedAt: dateToIsoOrNull(row?.lastEnqueuedAt ?? null),
    lastStartedAt: dateToIsoOrNull(row?.lastStartedAt ?? null),
    lastSucceededAt: dateToIsoOrNull(row?.lastSucceededAt ?? null),
    lastFailedAt: dateToIsoOrNull(row?.lastFailedAt ?? null),
    failureCode: row?.failureCode ?? null,
    failureMessage: row?.failureMessage ?? null,
    consecutiveFailureCount: row?.consecutiveFailureCount ?? 0,
    manualRecompute,
  };
}

/**
 * Loads an aggregated admin detail payload for one user: list-compatible user row,
 * account timestamps, invite lifecycle (when tied to signup), onboarding columns,
 * and import/listen counters plus the newest user-sourced import job.
 */
export async function getAdminUserDetailById(
  db: Db,
  userId: string,
): Promise<AdminUserDetailRecord | null> {
  const [coreRes, latestUserJob, layer1Row, inputWatermark, lastMaterializedSignalVersion] =
    await Promise.all([
    db.query<QueryResultRow>(
      `select u.id,
              u.email,
              u.display_name,
              u.lastfm_username,
              u.account_role,
              u.account_status,
              u.product_plan,
              u.created_at,
              u.updated_at,
              u.email_verified_at,
              u.stats_timezone,
              u.welcome_email_sent_at,
              u.signup_beta_invite_id,
              u.onboarding_state,
              u.onboarding_dismissed_at,
              u.onboarding_completed_at,
              u.onboarding_deferred_at,
              u.onboarding_import_ready_email_sent_at,
              bi.locked_email as invite_locked_email,
              bi.created_at as invite_created_at,
              bi.created_by_user_id as invite_created_by_user_id,
              bi.max_uses as invite_max_uses,
              bi.used_count as invite_used_count,
              bi.expires_at as invite_expires_at,
              bi.revoked_at as invite_revoked_at,
              bi.revoked_reason as invite_revoked_reason,
              bir.redeemed_at as invite_redeemed_at,
              (select count(*)::int from listens l where l.user_id = u.id) as listen_count,
              (select count(*)::int from import_jobs ij where ij.user_id = u.id) as import_job_total_count,
              (select count(*)::int
                 from import_jobs ij
                where ij.user_id = u.id
                  and ij.stage in ('queued', 'running')) as import_job_active_count
         from users u
         left join beta_invites bi on bi.id = u.signup_beta_invite_id
         left join beta_invite_redemptions bir
                on bir.invite_id = bi.id
               and bir.redeemed_user_id = u.id
        where u.id = $1::uuid
        limit 1`,
      [userId],
    ),
    getLatestDashboardImportJobForUser(db, userId),
    getLayer1UserRecomputeStateRow(db, userId),
    queryLayer1InputWatermarkForUser(db, userId),
    queryLatestLayer1MaterializedSignalVersionString(db, userId),
  ]);

  const row = coreRes.rows[0];
  if (!row) {
    return null;
  }

  const user = mapListRecordFromCoreRow(row);
  const state = parseOnboardingState(row["onboarding_state"]);
  if (state === null) {
    throw new Error(
      `getAdminUserDetailById: invalid onboarding_state "${String(row["onboarding_state"])}" for user ${userId}`,
    );
  }

  const signupBetaInvite: AdminUserDetailInviteProvenance | null =
    user.signup_beta_invite_id === null
      ? null
      : {
          id: user.signup_beta_invite_id,
          lockedEmail: user.invite_locked_email,
          createdAt: user.invite_created_at,
          createdByUserId: user.invite_created_by_user_id,
          maxUses: numOrZero(row["invite_max_uses"]),
          usedCount: numOrZero(row["invite_used_count"]),
          expiresAt: pgTimestamptzToIsoOrNull(row["invite_expires_at"]),
          revokedAt: pgTimestamptzToIsoOrNull(row["invite_revoked_at"]),
          revokedReason:
            row["invite_revoked_reason"] === null ||
            row["invite_revoked_reason"] === undefined
              ? null
              : String(row["invite_revoked_reason"]),
          redeemedAt: pgTimestamptzToIsoOrNull(row["invite_redeemed_at"]),
        };

  return {
    user,
    account: {
      updatedAt: pgTimestamptzToIsoString(row["updated_at"]),
      emailVerifiedAt: pgTimestamptzToIsoOrNull(row["email_verified_at"]),
      statsTimezone:
        row["stats_timezone"] === null || row["stats_timezone"] === undefined
          ? null
          : String(row["stats_timezone"]),
      welcomeEmailSentAt: pgTimestamptzToIsoOrNull(row["welcome_email_sent_at"]),
    },
    signupBetaInvite,
    onboarding: {
      state,
      dismissedAt: pgTimestamptzToIsoOrNull(row["onboarding_dismissed_at"]),
      completedAt: pgTimestamptzToIsoOrNull(row["onboarding_completed_at"]),
      deferredAt: pgTimestamptzToIsoOrNull(row["onboarding_deferred_at"]),
      importReadyEmailSentAt: pgTimestamptzToIsoOrNull(
        row["onboarding_import_ready_email_sent_at"],
      ),
    },
    importSummary: {
      totalJobCount: numOrZero(row["import_job_total_count"]),
      activeJobCount: numOrZero(row["import_job_active_count"]),
      listenCount: numOrZero(row["listen_count"]),
      latestUserJob,
      latestUserImportStatus: deriveImportStatusLabel(latestUserJob),
    },
    layer1: buildAdminLayer1Summary({
      productPlanRaw: user.product_plan,
      layer1Row,
      currentInputWatermark: inputWatermark,
      lastMaterializedSignalVersion,
    }),
  };
}
