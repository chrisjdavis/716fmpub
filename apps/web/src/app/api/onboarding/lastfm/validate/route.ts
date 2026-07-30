import { NextResponse } from "next/server";
import {
  getPool,
  getUserLastfmApiKey,
  getUserProfileFields,
  tryInsertSecurityAuditEvent,
  updateUserOnboardingState,
} from "@vs/db";
import { sanitizeUserFacingPlainText } from "@vs/domain";
import { loadServerEnv } from "@vs/env";
import { LastfmProviderApiError, lookupLastfmUsername } from "@vs/lastfm-provider";
import { onboardingLastfmValidateBodySchema } from "@/server/api/onboarding-input-schemas";
import { emailVerificationRequiredUnlessSatisfied } from "@/server/api/email-verification-api-gate";
import { parseJsonBodyWithSchema } from "@/server/api/validated-json-body";
import { withApiSession } from "@/server/api/require-session";
import { loadOnboardingStatePayload } from "@/server/onboarding-state-response";

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
      onboardingLastfmValidateBodySchema,
      env.VS_API_JSON_BODY_MAX_ACCOUNT_BYTES,
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    const profile = await getUserProfileFields(pool, user.id);
    const storedKey = await getUserLastfmApiKey(pool, user.id);
    const lastfmUsername =
      parsed.data.lastfmUsername?.trim() ||
      String(profile?.lastfm_username ?? "").trim();
    const lastfmApiKey = parsed.data.lastfmApiKey ?? storedKey ?? "";
    if (lastfmUsername === "" || lastfmApiKey.trim() === "") {
      return NextResponse.json(
        {
          ok: false as const,
          state: "configure_lastfm" as const,
          error_code: "missing_lastfm_credentials" as const,
          message: "Save your Last.fm username and API key before verifying.",
        },
        { status: 400 },
      );
    }

    let lookup;
    try {
      lookup = await lookupLastfmUsername({
        apiKey: lastfmApiKey.trim(),
        username: lastfmUsername,
      });
    } catch (err) {
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: user.id,
        action: "onboarding.lastfm_validate",
        outcome: "failure",
        metadata: {
          code: "unknown_validation_error",
        },
      });
      if (err instanceof LastfmProviderApiError) {
        return NextResponse.json(
          {
            ok: false as const,
            state: "configure_lastfm" as const,
            error_code: "provider_unavailable" as const,
            message:
              "Last.fm could not be reached. Check your connection and try again.",
          },
          { status: 503 },
        );
      }
      throw err;
    }

    if (!lookup.ok) {
      const code =
        lookup.kind === "invalid_username"
          ? ("lastfm_user_not_found" as const)
          : ("invalid_lastfm_credentials" as const);
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: user.id,
        action: "onboarding.lastfm_validate",
        outcome: "failure",
        metadata: { code },
      });
      const message =
        lookup.kind === "invalid_username"
          ? "We could not find that Last.fm username. Check the spelling and try again."
          : "We could not verify those credentials. Check the API key and username, then try again.";
      return NextResponse.json(
        {
          ok: false as const,
          state: "configure_lastfm" as const,
          error_code: code,
          message: sanitizeUserFacingPlainText(message),
        },
        { status: 400 },
      );
    }

    await updateUserOnboardingState(pool, user.id, {
      state: "ready_to_import",
    });
    await tryInsertSecurityAuditEvent(pool, {
      actorUserId: user.id,
      action: "onboarding.lastfm_validate",
      outcome: "success",
      metadata: {},
    });
    const payload = await loadOnboardingStatePayload({ pool, user });
    return NextResponse.json({
      ok: true as const,
      state: "ready_to_import" as const,
      normalized_username: sanitizeUserFacingPlainText(lastfmUsername),
      can_import: true as const,
      onboarding: payload,
    });
  });
}
