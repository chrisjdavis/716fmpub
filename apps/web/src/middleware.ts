import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { parseAbuseEnvFields, pickAbuseEnvRaw } from "@vs/env/abuse-env-fields";
import { sessionCookieGateResponse } from "@/server/api/api-edge-session-gate";
import { rateLimitResponseIfExceeded } from "@/server/api/middleware-rate-limit";
import { readEdgeTransportContext } from "@/server/http/edge-transport-context";
import {
  finalizeTransportSecurityHeaders,
  transportInsecureResponse,
} from "./middleware.transport";

const TRACE_HEADER = "x-vs-trace" as const;

function nextWithIncomingTrace(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  if (!headers.get(TRACE_HEADER)?.trim()) {
    headers.set(TRACE_HEADER, crypto.randomUUID());
  }
  return NextResponse.next({ request: { headers } });
}

/**
 * Edge middleware: strict-tier HTTPS upgrade, HSTS on HTTPS responses, browser baseline headers
 * (CSP, frame protection, MIME sniffing guard, referrer and permissions policies, COOP), `/api/*`
 * rate limiting, and session cookie prefilter. Authoritative auth remains in route handlers.
 * `/api/internal/*` skips the session cookie gate and uses Bearer-secret auth inside handlers.
 * @see docs/security-architecture.md
 */
export function middleware(request: NextRequest): NextResponse {
  const ctx = readEdgeTransportContext(process.env as Record<string, string | undefined>);
  const finish = (res: NextResponse): NextResponse =>
    finalizeTransportSecurityHeaders(res, request, ctx);

  if (request.method !== "OPTIONS") {
    const transportBlock = transportInsecureResponse(request, ctx);
    if (transportBlock) {
      return finish(transportBlock);
    }
  }

  if (request.method === "OPTIONS") {
    return finish(nextWithIncomingTrace(request));
  }

  if (!request.nextUrl.pathname.startsWith("/api")) {
    return finish(nextWithIncomingTrace(request));
  }

  const abuseEnv = parseAbuseEnvFields(
    pickAbuseEnvRaw(process.env as Record<string, string | undefined>),
  );
  const rateLimited = rateLimitResponseIfExceeded(
    request,
    abuseEnv,
    Date.now(),
    ctx.trustProxy,
  );
  if (rateLimited) {
    return finish(rateLimited);
  }

  const denied = sessionCookieGateResponse(request);
  if (denied) {
    return finish(denied);
  }
  return finish(nextWithIncomingTrace(request));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
