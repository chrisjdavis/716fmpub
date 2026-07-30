import { NextResponse } from "next/server";
import { getPool, tryInsertSecurityAuditEvent } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { apiCsrfInvalidJson } from "@/server/api/api-csrf-response";
import { authLogoutBodySchema } from "@/server/api/auth-account-input-schemas";
import { parseOptionalJsonBodyWithSchema } from "@/server/api/validated-json-body";
import { clearCsrfCookie, csrfDoubleSubmitValid } from "@/server/auth/csrf-cookie";
import {
  clearSessionCookie,
  destroySessionByRawTokenReturningUserId,
  lookupUserIdBySessionRawToken,
  readSessionRawToken,
} from "@/server/auth/session";
import { rejectUnlessTrustedAuthTransport } from "@/server/http/auth-transport-guard";
import { withPublicApiRouteTiming } from "@/server/observability/public-api-timing";

export async function POST(req: Request): Promise<Response> {
  return withPublicApiRouteTiming(req, async () => {
  const env = loadServerEnv();
  const transportDenied = rejectUnlessTrustedAuthTransport(req, env);
  if (transportDenied) {
    return transportDenied;
  }
  const logoutBodyCap = Math.min(4096, env.VS_API_JSON_BODY_MAX_AUTH_BYTES);
  const body = await parseOptionalJsonBodyWithSchema(req, authLogoutBodySchema, logoutBodyCap);
  if (!body.ok) {
    return body.response;
  }

  const raw = await readSessionRawToken();
  if (raw?.trim()) {
    const csrfOk = await csrfDoubleSubmitValid(req);
    if (!csrfOk) {
      const pool = getPool(env);
      const uid = await lookupUserIdBySessionRawToken(pool, raw);
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: uid,
        action: "auth.logout",
        outcome: "denied",
        metadata: { reason: "csrf_invalid" },
      });
      return apiCsrfInvalidJson();
    }
  }
  if (raw) {
    const pool = getPool(env);
    const userId = await destroySessionByRawTokenReturningUserId(pool, raw);
    await tryInsertSecurityAuditEvent(pool, {
      actorUserId: userId,
      action: "auth.logout",
      outcome: userId ? "success" : "failure",
      metadata: userId ? {} : { reason: "session_not_found" },
    });
  }

  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  clearCsrfCookie(res);
  return res;
  });
}
