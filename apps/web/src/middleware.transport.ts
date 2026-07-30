import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  applyBrowserSecurityHeaders,
  readRealtimeWsUrlCandidatesFromEnv,
  resolveNodeEnvForCsp,
} from "@/server/http/browser-security-headers";
import type { EdgeTransportContext } from "@/server/http/edge-transport-context";
import { requestUsesHttps } from "@/server/http/request-transport";

const HSTS = "max-age=15552000; includeSubDomains";

export function transportInsecureResponse(
  request: NextRequest,
  ctx: EdgeTransportContext,
): NextResponse | null {
  if (!ctx.strict) {
    return null;
  }
  if (requestUsesHttps(request.nextUrl, request.headers, ctx.trustProxy)) {
    return null;
  }
  if (!ctx.publicAppOrigin) {
    return NextResponse.json(
      {
        error: "HTTPS is required but public origin is not configured",
        code: "transport_misconfigured",
      },
      { status: 503 },
    );
  }
  const target = `${ctx.publicAppOrigin}${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (request.method === "GET" || request.method === "HEAD") {
    return NextResponse.redirect(target, 308);
  }
  return NextResponse.json(
    { error: "HTTPS is required for this application", code: "insecure_transport" },
    { status: 403 },
  );
}

export function finalizeTransportSecurityHeaders(
  res: NextResponse,
  request: NextRequest,
  ctx: EdgeTransportContext,
  scriptNonce?: string,
): NextResponse {
  const env = process.env as Record<string, string | undefined>;
  applyBrowserSecurityHeaders(res.headers, {
    nodeEnv: resolveNodeEnvForCsp(env.NODE_ENV),
    realtimeWsUrlCandidates: readRealtimeWsUrlCandidatesFromEnv(env),
    scriptNonce,
  });
  if (
    ctx.strict &&
    requestUsesHttps(request.nextUrl, request.headers, ctx.trustProxy)
  ) {
    res.headers.set("Strict-Transport-Security", HSTS);
  }
  return res;
}
