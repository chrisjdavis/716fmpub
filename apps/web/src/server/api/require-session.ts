import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE_NAME } from "@vs/domain";
import { getPool, runWithDbPerfContext } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { apiAuthenticationRequiredJson } from "@/server/api/api-auth-response";
import { cookieAuthCsrfProofOr403 } from "@/server/api/api-csrf-guard";
import { rejectUnlessTrustedAuthTransport } from "@/server/http/auth-transport-guard";
import {
  applyCsrfCookie,
  isUnsafeHttpMethod,
  newCsrfToken,
  readCsrfCookieRaw,
} from "@/server/auth/csrf-cookie";
import {
  applySessionCookie,
  readSessionRawToken,
  validateSession,
  type AuthenticatedUser,
} from "@/server/auth/session";
import {
  emitApiRequestPerf,
  httpClassOutcome,
} from "@/server/observability/server-perf-log";

const TRACE_HEADER = "x-vs-trace" as const;

function readOrCreateTraceId(request: Request): string {
  const existing = request.headers.get(TRACE_HEADER)?.trim();
  if (existing) {
    return existing;
  }
  return crypto.randomUUID();
}

export type SessionGate =
  | { ok: true; user: AuthenticatedUser; rotatedRawToken?: string }
  | { ok: false; response: NextResponse };

export async function requireSession(): Promise<SessionGate> {
  const raw = await readSessionRawToken();
  if (!raw) {
    return {
      ok: false,
      response: apiAuthenticationRequiredJson(),
    };
  }
  const env = loadServerEnv();
  const pool = getPool(env);
  const v = await validateSession(pool, raw, "api");
  if (!v) {
    return {
      ok: false,
      response: apiAuthenticationRequiredJson(),
    };
  }
  return { ok: true, user: v.user, rotatedRawToken: v.rotatedRawToken };
}

export function applySessionRotationToResponse(
  gate: SessionGate,
  res: Response,
): void {
  if (!gate.ok || gate.rotatedRawToken === undefined) {
    return;
  }
  if (res instanceof NextResponse) {
    if (res.headers.get("set-cookie")?.includes(`${AUTH_SESSION_COOKIE_NAME}=`)) {
      return;
    }
    applySessionCookie(res, gate.rotatedRawToken);
  }
}

/**
 * Runs a route handler with an authenticated user, enforces CSRF on unsafe HTTP methods,
 * may bootstrap the CSRF cookie on safe methods when missing, and applies rotated session cookies when issued.
 */
export async function withApiSession(
  request: Request,
  run: (ctx: { user: AuthenticatedUser }) => Promise<Response>,
): Promise<Response> {
  const routeLabel = `${request.method} ${new URL(request.url).pathname}`;
  const traceId = readOrCreateTraceId(request);
  return runWithDbPerfContext(
    { source: routeLabel, sourceKind: "api", traceId },
    async () => {
      const t0 = performance.now();
      const gate = await requireSession();
      const tAfterSession = performance.now();
      if (!gate.ok) {
        emitApiRequestPerf({
          route: routeLabel,
          traceId,
          totalMs: Math.round((tAfterSession - t0) * 1000) / 1000,
          outcome: "unauthenticated",
          status: gate.response.status,
        });
        return gate.response;
      }
      if (isUnsafeHttpMethod(request.method)) {
        const env = loadServerEnv();
        const transportDenied = rejectUnlessTrustedAuthTransport(request, env);
        if (transportDenied) {
          emitApiRequestPerf({
            route: routeLabel,
            traceId,
            totalMs: Math.round((performance.now() - t0) * 1000) / 1000,
            outcome: "transport_denied",
            status: transportDenied.status,
          });
          return transportDenied;
        }
      }
      const csrfDenied = await cookieAuthCsrfProofOr403(request);
      if (csrfDenied) {
        emitApiRequestPerf({
          route: routeLabel,
          traceId,
          totalMs: Math.round((performance.now() - t0) * 1000) / 1000,
          outcome: "csrf_denied",
          status: csrfDenied.status,
        });
        return csrfDenied;
      }
      const tBeforeHandler = performance.now();
      const res = await run({ user: gate.user });
      const tAfterHandler = performance.now();
      if (res instanceof NextResponse) {
        applySessionRotationToResponse(gate, res);
        if (gate.ok && !isUnsafeHttpMethod(request.method)) {
          const existing = await readCsrfCookieRaw();
          if (!existing?.trim()) {
            applyCsrfCookie(res, newCsrfToken());
          }
        }
      }
      const tEnd = performance.now();
      emitApiRequestPerf({
        route: routeLabel,
        traceId,
        totalMs: Math.round((tEnd - t0) * 1000) / 1000,
        sessionMs: Math.round((tAfterSession - t0) * 1000) / 1000,
        guardMs: Math.round((tBeforeHandler - tAfterSession) * 1000) / 1000,
        handlerMs: Math.round((tAfterHandler - tBeforeHandler) * 1000) / 1000,
        responseTailMs: Math.round((tEnd - tAfterHandler) * 1000) / 1000,
        outcome: httpClassOutcome(res.status),
        status: res.status,
      });
      return res;
    },
  );
}
