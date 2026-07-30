import { NextResponse } from "next/server";
import { getPool, tryInsertSecurityAuditEvent } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { rejectIfAuthAbuseRateLimited } from "@/server/api/auth-abuse-rate-limit";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { applyCsrfCookie, newCsrfToken } from "@/server/auth/csrf-cookie";
import {
  applySessionCookie,
  createDbSession,
  invalidatePriorSessionsForAuthTransition,
  readSessionRawToken,
} from "@/server/auth/session";
import { findUserWithPasswordByEmail } from "@/server/auth/user-repository";
import { authLoginBodySchema } from "@/server/api/auth-account-input-schemas";
import { parseJsonBodyWithSchema } from "@/server/api/validated-json-body";
import { rejectUnlessTrustedAuthTransport } from "@/server/http/auth-transport-guard";
import { withPublicApiRouteTiming } from "@/server/observability/public-api-timing";

const GENERIC_AUTH_FAILURE = "Invalid email or password";

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
    authLoginBodySchema,
    env.VS_API_JSON_BODY_MAX_AUTH_BYTES,
  );
  if (!parsed.ok) {
    return parsed.response;
  }

  const email = parsed.data.email;
  const pool = getPool(env);
  const user = await findUserWithPasswordByEmail(pool, email);
  if (!user) {
    await hashPassword(parsed.data.password);
    await tryInsertSecurityAuditEvent(pool, {
      actorUserId: null,
      action: "auth.login",
      outcome: "failure",
      metadata: { reason: "invalid_credentials" },
    });
    return NextResponse.json({ error: GENERIC_AUTH_FAILURE }, { status: 401 });
  }

  const ok = await verifyPassword(parsed.data.password, user.password_hash);
  if (!ok) {
    await tryInsertSecurityAuditEvent(pool, {
      actorUserId: user.id,
      action: "auth.login",
      outcome: "failure",
      metadata: { reason: "invalid_credentials" },
    });
    return NextResponse.json({ error: GENERIC_AUTH_FAILURE }, { status: 401 });
  }

  const priorSessionRaw = await readSessionRawToken();
  await invalidatePriorSessionsForAuthTransition(pool, {
    userId: user.id,
    requestSessionRawToken: priorSessionRaw,
  });
  const { rawToken } = await createDbSession(pool, user.id);
  await tryInsertSecurityAuditEvent(pool, {
    actorUserId: user.id,
    action: "auth.login",
    outcome: "success",
    metadata: {},
  });
  const res = NextResponse.json({
    user: { id: user.id, email: user.email, accountRole: user.account_role },
  });
  applySessionCookie(res, rawToken);
  applyCsrfCookie(res, newCsrfToken());
  return res;
  });
}
