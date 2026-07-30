import { NextResponse } from "next/server";
import {
  getPool,
  markUserEmailVerifiedIfUnverified,
  withConsumedEmailVerificationToken,
  type ConsumeEmailVerificationFailure,
} from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { authVerifyEmailBodySchema } from "@/server/api/auth-account-input-schemas";
import { parseJsonBodyWithSchema } from "@/server/api/validated-json-body";
import { rejectUnlessTrustedAuthTransport } from "@/server/http/auth-transport-guard";
import { withPublicApiRouteTiming } from "@/server/observability/public-api-timing";
import { enqueueWelcomeEmailIfConfigured } from "@/server/welcome-email-enqueue";

const VERIFY_EMAIL_FAILURE_MESSAGES: Record<ConsumeEmailVerificationFailure, string> = {
  invalid_token: "This verification link is invalid or incomplete.",
  expired: "This verification link has expired.",
  replayed: "This verification link was already used.",
};

export async function POST(req: Request): Promise<Response> {
  return withPublicApiRouteTiming(req, async () => {
    const env = loadServerEnv();
    const transportDenied = rejectUnlessTrustedAuthTransport(req, env);
    if (transportDenied) {
      return transportDenied;
    }
    const parsed = await parseJsonBodyWithSchema(
      req,
      authVerifyEmailBodySchema,
      env.VS_API_JSON_BODY_MAX_AUTH_BYTES,
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    const pool = getPool(env);
    const result = await withConsumedEmailVerificationToken(
      pool,
      { rawToken: parsed.data.token },
      async (client, { userId }) => {
        const verified = await markUserEmailVerifiedIfUnverified(client, userId);
        return { ...verified, userId };
      },
    );

    if (!result.ok) {
      const code = result.reason;
      return NextResponse.json(
        {
          ok: false as const,
          code,
          error: VERIFY_EMAIL_FAILURE_MESSAGES[code],
        },
        { status: 400 },
      );
    }

    const { email, newlyVerified, userId } = result.value;
    const res = NextResponse.json({
      ok: true as const,
      email,
      newlyVerified,
    });
    if (newlyVerified && env.welcomeEmailTrigger === "email_verified") {
      enqueueWelcomeEmailIfConfigured({ env, pool, userId, when: "email_verified" });
    }
    return res;
  });
}
