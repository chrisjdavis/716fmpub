import { NextResponse } from "next/server";
import {
  getPool,
  PURGE_USER_LISTEN_DATA_CONFIRM_PHRASE,
  purgeUserListenData,
  STEP_UP_PURPOSE_PURGE_LISTEN_DATA,
  tryInsertSecurityAuditEvent,
  withConsumedStepUpToken,
} from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { purgeListenDataBodySchema } from "@/server/api/auth-account-input-schemas";
import { parseJsonBodyWithSchema } from "@/server/api/validated-json-body";
import { emailVerificationRequiredUnlessSatisfied } from "@/server/api/email-verification-api-gate";
import { withApiSession } from "@/server/api/require-session";
import { invalidateListeningHistoryDerivedReadCaches } from "@/server/listening-history-read-cache-invalidation";

export async function POST(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const denied = emailVerificationRequiredUnlessSatisfied(user);
    if (denied) {
      return denied;
    }
    const env = loadServerEnv();
    const parsed = await parseJsonBodyWithSchema(
      req,
      purgeListenDataBodySchema,
      env.VS_API_JSON_BODY_MAX_ACCOUNT_BYTES,
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    const pool = getPool(env);

    if (parsed.data.confirmPhrase.trim() !== PURGE_USER_LISTEN_DATA_CONFIRM_PHRASE) {
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: user.id,
        action: "listen_data.deletion_attempt",
        outcome: "failure",
        metadata: { reason: "confirm_phrase_mismatch" },
      });
      return NextResponse.json(
        { error: "Confirmation phrase does not match the required text" },
        { status: 400 },
      );
    }
    const step = await withConsumedStepUpToken(
      pool,
      {
        userId: user.id,
        purpose: STEP_UP_PURPOSE_PURGE_LISTEN_DATA,
        rawToken: parsed.data.stepUpToken,
      },
      (client) => purgeUserListenData(client, user.id),
    );

    if (!step.ok) {
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: user.id,
        action: "listen_data.deletion_attempt",
        outcome: "denied",
        metadata: { reason: step.reason },
      });
      const byReason = {
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
      };
      const payload = byReason[step.reason];
      return NextResponse.json(
        { error: payload.error, code: payload.code },
        { status: 403 },
      );
    }

    await tryInsertSecurityAuditEvent(pool, {
      actorUserId: user.id,
      action: "listen_data.deletion_attempt",
      outcome: "success",
      metadata: {},
    });
    await tryInsertSecurityAuditEvent(pool, {
      actorUserId: user.id,
      action: "listen_data.deletion_complete",
      outcome: "success",
      metadata: {
        listensDeleted: step.value.listensDeleted,
        importJobsDeleted: step.value.importJobsDeleted,
        analyticsSnapshotsDeleted: step.value.analyticsSnapshotsDeleted,
      },
    });

    invalidateListeningHistoryDerivedReadCaches(user.id);

    return NextResponse.json({
      ok: true,
      deleted: step.value,
    });
  });
}
