import { unlink } from "node:fs/promises";
import { NextResponse } from "next/server";
import {
  DELETE_USER_ACCOUNT_CONFIRM_PHRASE,
  deleteUserAccount,
  getPool,
  getUserProfileFields,
  HOME_BRIEFING_SNAPSHOT_KIND,
  insertSecurityAuditEvent,
  STEP_UP_PURPOSE_DELETE_ACCOUNT,
  tryInsertSecurityAuditEvent,
  updateUserProfileFields,
  withConsumedStepUpToken,
  type ConsumeStepUpFailure,
  type DeleteUserAccountResult,
  type UserProfileUpdateInput,
} from "@vs/db";
import {
  resolveExportArtifactAbsolutePath,
  sanitizeUserFacingPlainText,
  type AccountRole,
  type ProductPlan,
} from "@vs/domain";
import { loadServerEnv } from "@vs/env";
import { summarizeThrowableForLog } from "@vs/sensitive";
import {
  createAnalyticsQueue,
  createExportsQueue,
  createImportsQueue,
  createIncrementalSyncQueue,
  createSyncQueue,
  removeUserJobsFromQueue,
} from "@vs/queue";
import { deleteAccountBodySchema } from "@/server/api/auth-account-input-schemas";
import { meProfilePatchBodySchema } from "@/server/api/me-profile-patch";
import { parseJsonBodyWithSchema } from "@/server/api/validated-json-body";
import { emailVerificationRequiredUnlessSatisfied } from "@/server/api/email-verification-api-gate";
import { withApiSession } from "@/server/api/require-session";
import { clearCsrfCookie } from "@/server/auth/csrf-cookie";
import { clearSessionCookie } from "@/server/auth/session";
import { invalidateListeningHistoryDerivedReadCaches } from "@/server/listening-history-read-cache-invalidation";

function meJsonUser(input: {
  id: string;
  email: string;
  emailVerified: boolean;
  accountRole: AccountRole;
  productPlan: ProductPlan;
  displayName: string | null;
  lastfmUsername: string | null;
  hasLastfmApiKey: boolean;
  statsTimezone: string | null;
  listeningHistoryPublic: boolean;
}) {
  return {
    user: {
      id: input.id,
      email: sanitizeUserFacingPlainText(input.email),
      emailVerified: input.emailVerified,
      accountRole: input.accountRole,
      productPlan: input.productPlan,
      displayName:
        input.displayName === null ? null : sanitizeUserFacingPlainText(input.displayName),
      lastfmUsername:
        input.lastfmUsername === null ? null : sanitizeUserFacingPlainText(input.lastfmUsername),
      hasLastfmApiKey: input.hasLastfmApiKey,
      statsTimezone:
        input.statsTimezone === null ? null : sanitizeUserFacingPlainText(input.statsTimezone),
      listeningHistoryPublic: input.listeningHistoryPublic,
    },
  };
}

const STEP_UP_FAILURE_RESPONSE = {
  invalid_token: {
    code: "step_up_invalid" as const,
    error: "Step-up confirmation is missing or not valid for this action.",
  },
  expired: {
    code: "step_up_expired" as const,
    error: "Step-up confirmation has expired. Re-enter your password to continue.",
  },
  replayed: {
    code: "step_up_replayed" as const,
    error: "This step-up confirmation was already used.",
  },
  wrong_user: {
    code: "step_up_invalid" as const,
    error: "Step-up confirmation is missing or not valid for this action.",
  },
} as const;

class AccountDeleteActiveWorkError extends Error {
  constructor(public readonly notRemoved: number) {
    super("Account deletion has locked active work");
    this.name = "AccountDeleteActiveWorkError";
  }
}

async function removeQueuedUserWork(
  env: ReturnType<typeof loadServerEnv>,
  userId: string,
): Promise<{ removed: number; notRemoved: number }> {
  const queues = [
    createImportsQueue(env),
    createIncrementalSyncQueue(env),
    createSyncQueue(env),
    createAnalyticsQueue(env),
    createExportsQueue(env),
  ];
  let removed = 0;
  let notRemoved = 0;
  try {
    for (const queue of queues) {
      const result = await removeUserJobsFromQueue(queue, userId);
      removed += result.removed;
      notRemoved += result.notRemoved;
    }
  } finally {
    await Promise.allSettled(queues.map((queue) => queue.close()));
  }
  return { removed, notRemoved };
}

async function deleteExportArtifactsBestEffort(
  artifactsBaseDir: string,
  relativePaths: readonly string[],
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (const relativePath of relativePaths) {
    let absolutePath: string;
    try {
      absolutePath = resolveExportArtifactAbsolutePath(artifactsBaseDir, relativePath);
    } catch (err) {
      failed += 1;
      console.warn(
        "[api/me] refusing unsafe export artifact path during account deletion:",
        summarizeThrowableForLog(err),
      );
      continue;
    }
    try {
      await unlink(absolutePath);
      deleted += 1;
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : "";
      if (code === "ENOENT") {
        continue;
      }
      failed += 1;
      console.warn(
        "[api/me] export artifact unlink failed during account deletion:",
        summarizeThrowableForLog(err),
      );
    }
  }
  return { deleted, failed };
}

export async function GET(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const env = loadServerEnv();
    const pool = getPool(env);
    const profile = await getUserProfileFields(pool, user.id);
    return NextResponse.json(
      meJsonUser({
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        accountRole: user.accountRole,
        productPlan: user.productPlan,
        displayName: profile?.display_name ?? null,
        lastfmUsername: profile?.lastfm_username ?? null,
        hasLastfmApiKey: profile?.has_lastfm_api_key ?? false,
        statsTimezone: profile?.stats_timezone ?? null,
        listeningHistoryPublic: profile?.listening_history_public ?? false,
      }),
    );
  });
}

export async function PATCH(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const denied = emailVerificationRequiredUnlessSatisfied(user);
    if (denied) {
      return denied;
    }
    const env = loadServerEnv();
    const parsed = await parseJsonBodyWithSchema(
      req,
      meProfilePatchBodySchema,
      env.VS_API_JSON_BODY_MAX_ACCOUNT_BYTES,
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    const pool = getPool(env);
    const profileBefore = await getUserProfileFields(pool, user.id);
    const profilePatch: UserProfileUpdateInput = {
      displayName: parsed.data.displayName,
      lastfmUsername: parsed.data.lastfmUsername,
      ...(parsed.data.lastfmApiKey !== undefined
        ? { lastfmApiKey: parsed.data.lastfmApiKey }
        : {}),
      ...(parsed.data.statsTimezone !== undefined
        ? { statsTimezone: parsed.data.statsTimezone }
        : {}),
      ...(parsed.data.listeningHistoryPublic !== undefined
        ? { listeningHistoryPublic: parsed.data.listeningHistoryPublic }
        : {}),
    };
    await updateUserProfileFields(pool, user.id, profilePatch);
    if (parsed.data.statsTimezone !== undefined) {
      await pool.query(
        `delete from analytics_snapshots
         where user_id = $1::uuid and kind = $2`,
        [user.id, HOME_BRIEFING_SNAPSHOT_KIND],
      );
    }
    const profileAfter = await getUserProfileFields(pool, user.id);
    if (
      profileBefore?.lastfm_username !== profileAfter?.lastfm_username ||
      profileBefore?.has_lastfm_api_key !== profileAfter?.has_lastfm_api_key
    ) {
      invalidateListeningHistoryDerivedReadCaches(user.id);
    }
    const changedFields: Array<
      | "displayName"
      | "lastfmUsername"
      | "lastfmApiKey"
      | "statsTimezone"
      | "listeningHistoryPublic"
    > = ["displayName", "lastfmUsername"];
    if (parsed.data.lastfmApiKey !== undefined) {
      changedFields.push("lastfmApiKey");
    }
    if (parsed.data.statsTimezone !== undefined) {
      changedFields.push("statsTimezone");
    }
    if (parsed.data.listeningHistoryPublic !== undefined) {
      changedFields.push("listeningHistoryPublic");
    }
    await tryInsertSecurityAuditEvent(pool, {
      actorUserId: user.id,
      action: "account.settings_patch",
      outcome: "success",
      metadata: { changedFields },
    });
    return NextResponse.json(
      meJsonUser({
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        accountRole: user.accountRole,
        productPlan: user.productPlan,
        displayName: profileAfter?.display_name ?? null,
        lastfmUsername: profileAfter?.lastfm_username ?? null,
        hasLastfmApiKey: profileAfter?.has_lastfm_api_key ?? false,
        statsTimezone: profileAfter?.stats_timezone ?? null,
        listeningHistoryPublic: profileAfter?.listening_history_public ?? false,
      }),
    );
  });
}

export async function DELETE(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const denied = emailVerificationRequiredUnlessSatisfied(user);
    if (denied) {
      return denied;
    }
    const env = loadServerEnv();
    const parsed = await parseJsonBodyWithSchema(
      req,
      deleteAccountBodySchema,
      env.VS_API_JSON_BODY_MAX_ACCOUNT_BYTES,
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    const pool = getPool(env);

    if (parsed.data.confirmPhrase.trim() !== DELETE_USER_ACCOUNT_CONFIRM_PHRASE) {
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: user.id,
        action: "account.delete_attempt",
        outcome: "failure",
        metadata: { reason: "confirm_phrase_mismatch" },
      });
      return NextResponse.json(
        { error: "Confirmation phrase does not match the required text" },
        { status: 400 },
      );
    }

    let step:
      | {
          ok: true;
          value: {
            account: DeleteUserAccountResult;
            queuedWork: { removed: number; notRemoved: number };
          };
        }
      | { ok: false; reason: ConsumeStepUpFailure };
    try {
      step = await withConsumedStepUpToken(
        pool,
        {
          userId: user.id,
          purpose: STEP_UP_PURPOSE_DELETE_ACCOUNT,
          rawToken: parsed.data.stepUpToken,
        },
        async (client) => {
          const queuedWork = await removeQueuedUserWork(env, user.id);
          if (queuedWork.notRemoved > 0) {
            throw new AccountDeleteActiveWorkError(queuedWork.notRemoved);
          }
          await insertSecurityAuditEvent(client, {
            actorUserId: user.id,
            action: "account.delete_complete",
            outcome: "success",
            metadata: {
              queuedJobsRemoved: queuedWork.removed,
              queuedJobsNotRemoved: queuedWork.notRemoved,
            },
          });
          const account = await deleteUserAccount(client, user.id);
          return { account, queuedWork };
        },
      );
    } catch (err) {
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: user.id,
        action: "account.delete_attempt",
        outcome: "failure",
        metadata: {
          reason:
            err instanceof AccountDeleteActiveWorkError
              ? "active_account_work_locked"
              : "account_delete_operation_failed",
        },
      });
      if (err instanceof AccountDeleteActiveWorkError) {
        return NextResponse.json(
          {
            error:
              "Account deletion is waiting on active account work to finish. Try again in a minute.",
            code: "account_delete_active_work",
          },
          { status: 409 },
        );
      }
      console.error(
        "[api/me] account deletion operation failed:",
        summarizeThrowableForLog(err),
      );
      return NextResponse.json(
        {
          error:
            "Could not complete account deletion. Try again in a minute, then contact support if it keeps happening.",
          code: "account_delete_operation_failed",
        },
        { status: 503 },
      );
    }

    if (!step.ok) {
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: user.id,
        action: "account.delete_attempt",
        outcome: "denied",
        metadata: { reason: step.reason },
      });
      const payload = STEP_UP_FAILURE_RESPONSE[step.reason];
      return NextResponse.json(
        { error: payload.error, code: payload.code },
        { status: 403 },
      );
    }

    const artifactCleanup = await deleteExportArtifactsBestEffort(
      env.EXPORT_ARTIFACTS_DIR,
      step.value.account.exportArtifactRelativePaths,
    );

    invalidateListeningHistoryDerivedReadCaches(user.id);

    const res = NextResponse.json({
      ok: true,
      deleted: {
        userDeleted: step.value.account.userDeleted,
        listensDeleted: step.value.account.listensDeleted,
        rawScrobblesDeleted: step.value.account.rawScrobblesDeleted,
        importJobsDeleted: step.value.account.importJobsDeleted,
        exportJobsDeleted: step.value.account.exportJobsDeleted,
        analyticsSnapshotsDeleted: step.value.account.analyticsSnapshotsDeleted,
        queuedJobsRemoved: step.value.queuedWork.removed,
        queuedJobsNotRemoved: step.value.queuedWork.notRemoved,
        exportArtifactsDeleted: artifactCleanup.deleted,
        exportArtifactsNotDeleted: artifactCleanup.failed,
      },
    });
    clearSessionCookie(res);
    clearCsrfCookie(res);
    return res;
  });
}
