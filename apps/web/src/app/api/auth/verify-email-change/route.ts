import { NextResponse } from "next/server";
import {
  applyVerifiedEmailChange,
  EmailChangeCompletionBlockedError,
  getPool,
  tryInsertSecurityAuditEvent,
  withConsumedEmailChangeToken,
  type ConsumeEmailChangeFailure,
} from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { authVerifyEmailChangeBodySchema } from "@/server/api/auth-account-input-schemas";
import { parseJsonBodyWithSchema } from "@/server/api/validated-json-body";
import { rejectUnlessTrustedAuthTransport } from "@/server/http/auth-transport-guard";
import { withPublicApiRouteTiming } from "@/server/observability/public-api-timing";

const FAILURE_MESSAGES: Record<ConsumeEmailChangeFailure, string> = {
  invalid_token: "This confirmation link is invalid or incomplete.",
  expired: "This confirmation link has expired.",
  replayed: "This confirmation link was already used.",
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
      authVerifyEmailChangeBodySchema,
      env.VS_API_JSON_BODY_MAX_AUTH_BYTES,
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    const pool = getPool(env);
    try {
      const result = await withConsumedEmailChangeToken(
        pool,
        { rawToken: parsed.data.token },
        async (client, { userId, newEmail }) =>
          applyVerifiedEmailChange(client, { userId, newEmail }),
      );

      if (!result.ok) {
        const code = result.reason;
        return NextResponse.json(
          {
            ok: false as const,
            code,
            error: FAILURE_MESSAGES[code],
          },
          { status: 400 },
        );
      }

      const { email, userId } = result.value;
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: userId,
        action: "account.email_change_complete",
        outcome: "success",
        metadata: {},
      });

      return NextResponse.json({
        ok: true as const,
        email,
      });
    } catch (err) {
      if (err instanceof EmailChangeCompletionBlockedError) {
        await tryInsertSecurityAuditEvent(pool, {
          actorUserId: err.userId,
          action: "account.email_change_complete",
          outcome: "denied",
          metadata: { reason: "email_unavailable" },
        });
        return NextResponse.json(
          {
            ok: false as const,
            code: err.code,
            error: "That email address is already in use on another account.",
          },
          { status: 409 },
        );
      }
      throw err;
    }
  });
}
