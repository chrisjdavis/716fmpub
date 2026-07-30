import { NextResponse } from "next/server";
import {
  getPool,
  getUserProfileFields,
  tryInsertSecurityAuditEvent,
  updateUserOnboardingState,
} from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { emailVerificationRequiredUnlessSatisfied } from "@/server/api/email-verification-api-gate";
import { withApiSession } from "@/server/api/require-session";
import { enqueueUserLastfmImport } from "@/server/enqueue-user-lastfm-import";
import { loadOnboardingStatePayload } from "@/server/onboarding-state-response";

export async function POST(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const denied = emailVerificationRequiredUnlessSatisfied(user);
    if (denied) {
      return denied;
    }
    const env = loadServerEnv();
    const pool = getPool(env);
    const profile = await getUserProfileFields(pool, user.id);
    const lfUser = profile?.lastfm_username?.trim() ?? "";
    if (lfUser === "" || !profile?.has_lastfm_api_key) {
      return NextResponse.json(
        {
          ok: false as const,
          code: "lastfm_not_configured" as const,
          message: "Save your Last.fm username and API key before starting an import.",
        },
        { status: 400 },
      );
    }

    const out = await enqueueUserLastfmImport({
      pool,
      env,
      userId: user.id,
      label: "716FM import",
      lastfmUsername: lfUser,
      allowIdempotentActive: true,
      auditImportTrigger: false,
    });

    if (!out.ok) {
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: user.id,
        action: "onboarding.import_start",
        outcome: "failure",
        metadata: { code: out.code },
      });
      await updateUserOnboardingState(pool, user.id, { state: "ready_to_import" });
      if (out.code === "redis_queues_disabled") {
        return NextResponse.json(
          {
            ok: false as const,
            code: out.code,
            message:
              "Background imports require Redis/BullMQ, which is disabled on this server.",
          },
          { status: 503 },
        );
      }
      if (out.code === "import_enqueue_failed") {
        return NextResponse.json(
          {
            ok: false as const,
            code: out.code,
            message: "Could not queue the import job. Try again in a moment.",
          },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { ok: false as const, code: out.code, message: "Could not start import." },
        { status: 409 },
      );
    }

    if (!out.alreadyActive) {
      await updateUserOnboardingState(pool, user.id, { state: "import_started" });
    }
    await tryInsertSecurityAuditEvent(pool, {
      actorUserId: user.id,
      action: "onboarding.import_start",
      outcome: "success",
      metadata: { importJobId: out.importJobId, alreadyActive: out.alreadyActive },
    });

    const payload = await loadOnboardingStatePayload({ pool, user });
    return NextResponse.json({
      ok: true as const,
      state: payload.state,
      job_enqueued: !out.alreadyActive,
      import_status: payload.importStatus,
      import_job_id: out.importJobId,
      onboarding: payload,
    });
  });
}
