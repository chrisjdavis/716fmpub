import { NextResponse } from "next/server";
import { getPool, issuePasswordRecoveryToken } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { summarizeThrowableForLog } from "@vs/sensitive";
import { rejectIfAuthAbuseRateLimited } from "@/server/api/auth-abuse-rate-limit";
import { buildPasswordRecoveryAbsoluteUrl } from "@/server/auth/password-recovery-url";
import { hashPassword } from "@/server/auth/password";
import { findUserWithPasswordByEmail } from "@/server/auth/user-repository";
import { authRecoveryRequestBodySchema } from "@/server/api/auth-account-input-schemas";
import { parseJsonBodyWithSchema } from "@/server/api/validated-json-body";
import { rejectUnlessTrustedAuthTransport } from "@/server/http/auth-transport-guard";
import { withPublicApiRouteTiming } from "@/server/observability/public-api-timing";
import { getWebTransactionalMailer } from "@/server/transactional-mailer";

/** Argon2-shaped work when no account matches, mirroring login-side dummy hashing (not a user password). */
function recoveryRequestTimingDummyInput(): string {
  return ["timing", "placeholder", "pass", "phrase", "9"].join("-");
}

const RECOVERY_REQUEST_OK_BODY = { ok: true as const };

export async function POST(req: Request): Promise<Response> {
  return withPublicApiRouteTiming(req, async () => {
  const env = loadServerEnv();
  const transportDenied = rejectUnlessTrustedAuthTransport(req, env);
  if (transportDenied) {
    return transportDenied;
  }
  const abuse = await rejectIfAuthAbuseRateLimited(req, env, "email_outbound");
  if (abuse) {
    return abuse;
  }
  const parsed = await parseJsonBodyWithSchema(
    req,
    authRecoveryRequestBodySchema,
    env.VS_API_JSON_BODY_MAX_AUTH_BYTES,
  );
  if (!parsed.ok) {
    return parsed.response;
  }

  const email = parsed.data.email;
  const pool = getPool(env);
  const user = await findUserWithPasswordByEmail(pool, email);
  if (!user) {
    await hashPassword(recoveryRequestTimingDummyInput());
    return NextResponse.json(RECOVERY_REQUEST_OK_BODY);
  }

  const origin = env.publicAppOrigin?.trim();
  const mailer = getWebTransactionalMailer();
  if (!origin || !mailer) {
    await hashPassword(recoveryRequestTimingDummyInput());
    return NextResponse.json(RECOVERY_REQUEST_OK_BODY);
  }

  const { rawToken } = await issuePasswordRecoveryToken(pool, user.id);
  try {
    const recoveryUrl = buildPasswordRecoveryAbsoluteUrl(origin, rawToken);
    await mailer.sendPasswordReset({
      to: user.email,
      recoveryUrl,
    });
  } catch (err) {
    console.error(
      `[api/auth/recovery/request] send failed userId=${user.id}:`,
      summarizeThrowableForLog(err),
    );
  }

  return NextResponse.json(RECOVERY_REQUEST_OK_BODY);
  });
}
