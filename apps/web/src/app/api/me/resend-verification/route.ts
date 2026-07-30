import { NextResponse } from "next/server";
import { getPool, issueEmailVerificationToken } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { summarizeThrowableForLog } from "@vs/sensitive";
import type { SignupEmailVerificationDispatch } from "@/lib/signup-email-verification-dispatch";
import { meResendVerificationBodySchema } from "@/server/api/auth-account-input-schemas";
import { parseJsonBodyWithSchema } from "@/server/api/validated-json-body";
import { withApiSession } from "@/server/api/require-session";
import { buildEmailVerificationAbsoluteUrl } from "@/server/auth/email-verification-url";
import { getWebTransactionalMailer } from "@/server/transactional-mailer";

export async function POST(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    if (user.emailVerified) {
      return NextResponse.json(
        {
          ok: false as const,
          code: "already_verified" as const,
          error: "This account email is already verified.",
        },
        { status: 400 },
      );
    }

    const env = loadServerEnv();
    const parsed = await parseJsonBodyWithSchema(
      req,
      meResendVerificationBodySchema,
      env.VS_API_JSON_BODY_MAX_ACCOUNT_BYTES,
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    const origin = env.publicAppOrigin?.trim();
    const mailer = getWebTransactionalMailer();

    let emailVerificationDispatch: SignupEmailVerificationDispatch;

    if (!origin) {
      emailVerificationDispatch = {
        status: "skipped",
        reason: "public_app_origin_missing",
      };
    } else if (!mailer) {
      emailVerificationDispatch = {
        status: "skipped",
        reason: "email_not_configured",
      };
    } else {
      const pool = getPool(env);
      const { rawToken } = await issueEmailVerificationToken(pool, user.id);
      try {
        const verificationUrl = buildEmailVerificationAbsoluteUrl(origin, rawToken);
        await mailer.sendSignupEmailVerification({
          to: user.email,
          verificationUrl,
        });
        emailVerificationDispatch = { status: "sent" };
      } catch (err) {
        console.error(
          `[api/me/resend-verification] send failed userId=${user.id}:`,
          summarizeThrowableForLog(err),
        );
        emailVerificationDispatch = { status: "failed", reason: "provider_error" };
      }
    }

    return NextResponse.json({
      ok: true as const,
      emailVerificationDispatch,
    });
  });
}
