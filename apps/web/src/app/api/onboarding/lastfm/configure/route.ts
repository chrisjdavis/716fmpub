import { NextResponse } from "next/server";
import {
  getPool,
  tryInsertSecurityAuditEvent,
  updateUserOnboardingState,
  updateUserProfileFields,
} from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { onboardingLastfmConfigureBodySchema } from "@/server/api/onboarding-input-schemas";
import { emailVerificationRequiredUnlessSatisfied } from "@/server/api/email-verification-api-gate";
import { parseJsonBodyWithSchema } from "@/server/api/validated-json-body";
import { withApiSession } from "@/server/api/require-session";
import { loadOnboardingStatePayload } from "@/server/onboarding-state-response";
import { invalidateListeningHistoryDerivedReadCaches } from "@/server/listening-history-read-cache-invalidation";

export async function POST(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const denied = emailVerificationRequiredUnlessSatisfied(user);
    if (denied) {
      return denied;
    }
    const env = loadServerEnv();
    const pool = getPool(env);
    const parsed = await parseJsonBodyWithSchema(
      req,
      onboardingLastfmConfigureBodySchema,
      env.VS_API_JSON_BODY_MAX_ACCOUNT_BYTES,
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    await updateUserProfileFields(pool, user.id, {
      lastfmUsername: parsed.data.lastfmUsername,
      lastfmApiKey: parsed.data.lastfmApiKey,
    });
    await updateUserOnboardingState(pool, user.id, {
      state: "configure_lastfm",
      clearDeferred: true,
    });
    await tryInsertSecurityAuditEvent(pool, {
      actorUserId: user.id,
      action: "onboarding.lastfm_configure",
      outcome: "success",
      metadata: {},
    });
    invalidateListeningHistoryDerivedReadCaches(user.id);
    const payload = await loadOnboardingStatePayload({ pool, user });
    return NextResponse.json({
      ok: true as const,
      normalizedUsername: parsed.data.lastfmUsername,
      hasLastfmApiKey: true,
      nextState: payload.state,
      onboarding: payload,
    });
  });
}
