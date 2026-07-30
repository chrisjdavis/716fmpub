import { NextResponse } from "next/server";
import {
  getPool,
  withConsumedPasswordRecoveryToken,
  type ConsumePasswordRecoveryFailure,
} from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { summarizeThrowableForLog } from "@vs/sensitive";
import { rejectIfAuthAbuseRateLimited } from "@/server/api/auth-abuse-rate-limit";
import { hashPassword } from "@/server/auth/password";
import {
  invalidatePriorSessionsForAuthTransition,
  readSessionRawToken,
} from "@/server/auth/session";
import { findUserEmailById, updateUserPasswordHash } from "@/server/auth/user-repository";
import { authRecoveryConfirmBodySchema } from "@/server/api/auth-account-input-schemas";
import { parseJsonBodyWithSchema } from "@/server/api/validated-json-body";
import { rejectUnlessTrustedAuthTransport } from "@/server/http/auth-transport-guard";
import { withPublicApiRouteTiming } from "@/server/observability/public-api-timing";
import { getWebTransactionalMailer } from "@/server/transactional-mailer";

const RECOVERY_CONFIRM_FAILURE_MESSAGES: Record<ConsumePasswordRecoveryFailure, string> = {
  invalid_token: "This recovery link is not valid. Request a new link from forgot password.",
  expired: "This recovery link has expired. Request a fresh reset link from forgot password.",
  replayed: "This link was already used to reset your password. Request a new link if you still need access.",
  account_not_active:
    "This account cannot reset its password while it is disabled or suspended. Contact support if you need access restored.",
};

export async function POST(req: Request): Promise<Response> {
  return withPublicApiRouteTiming(req, async () => {
  const env = loadServerEnv();
  const transportDenied = rejectUnlessTrustedAuthTransport(req, env);
  if (transportDenied) {
    return transportDenied;
  }
  const abuse = await rejectIfAuthAbuseRateLimited(req, env, "auth");
  if (abuse) {
    return abuse;
  }
  const parsed = await parseJsonBodyWithSchema(
    req,
    authRecoveryConfirmBodySchema,
    env.VS_API_JSON_BODY_MAX_AUTH_BYTES,
  );
  if (!parsed.ok) {
    return parsed.response;
  }

  const pool = getPool(env);
  const priorSessionRaw = await readSessionRawToken();
  const result = await withConsumedPasswordRecoveryToken(
    pool,
    { rawToken: parsed.data.token },
    async (client, { userId }) => {
      const newHash = await hashPassword(parsed.data.password);
      const updated = await updateUserPasswordHash(client, userId, newHash);
      if (!updated) {
        throw new Error("password recovery: user row missing during confirm");
      }
      await invalidatePriorSessionsForAuthTransition(client, {
        userId,
        requestSessionRawToken: priorSessionRaw,
      });
      const holder = await findUserEmailById(client, userId);
      if (!holder) {
        throw new Error("password recovery: user email missing during confirm");
      }
      return { email: holder.email };
    },
  );

  if (!result.ok) {
    const code = result.reason;
    return NextResponse.json(
      {
        ok: false as const,
        code,
        error: RECOVERY_CONFIRM_FAILURE_MESSAGES[code],
      },
      { status: 400 },
    );
  }

  const mailer = getWebTransactionalMailer();
  if (mailer) {
    try {
      await mailer.sendPasswordChangedConfirmation({
        to: result.value.email,
        changedAtIso: new Date().toISOString(),
      });
    } catch (err) {
      console.error(
        "[api/auth/recovery/confirm] password changed confirmation send failed:",
        summarizeThrowableForLog(err),
      );
    }
  }

  return NextResponse.json({
    ok: true,
    message: "Password updated. Sign in with your new password.",
  });
  });
}
