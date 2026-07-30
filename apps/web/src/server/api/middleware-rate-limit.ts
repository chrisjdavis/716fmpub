import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { AbuseEnvFields } from "@vs/env/abuse-env-fields";
import { consumeFixedWindowToken } from "@/server/api/fixed-window-rate-limit";

export type RateLimitBucket =
  | "auth"
  | "email_outbound"
  | "sensitive_post"
  | "destructive"
  | "internal";

function logEmailOutboundAbuseSignal(input: {
  kind: "rate_limited" | "window_cap_reached";
  pathname: string;
  clientIp: string;
  max: number;
  windowMs: number;
  retryAfterMs?: number;
}): void {
  const record: Record<string, string | number> = {
    event:
      input.kind === "rate_limited"
        ? "vs_api_abuse_email_outbound_rate_limited"
        : "vs_api_abuse_email_outbound_window_cap_reached",
    component: "middleware_rate_limit",
    pathname: input.pathname,
    clientIp: input.clientIp,
    maxRequests: input.max,
    windowMs: input.windowMs,
  };
  if (input.retryAfterMs !== undefined) {
    record.retryAfterMs = input.retryAfterMs;
  }
  console.warn(JSON.stringify(record));
}

/**
 * IPs from headers the **platform** sets (not generic `X-Forwarded-For`), so they are safe to use
 * for rate-limit keys even when `VS_TRUST_PROXY_HEADERS` is false.
 */
function platformInjectedClientIp(request: NextRequest): string | undefined {
  const vercel = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) {
    return vercel;
  }
  const fly = request.headers.get("fly-client-ip")?.trim();
  if (fly) {
    return fly;
  }
  return undefined;
}

function clientIp(request: NextRequest, trustProxyHeaders: boolean): string {
  if (!trustProxyHeaders) {
    return platformInjectedClientIp(request) ?? "unknown";
  }
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) {
    return cf;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }
  const xff = request.headers.get("x-forwarded-for")?.trim();
  if (xff && !xff.includes(",")) {
    // Only trust single-hop XFF (ingress overwrite). Multi-hop lists are spoofable at the client.
    return xff;
  }
  return platformInjectedClientIp(request) ?? "unknown";
}

function mutatingMethod(method: string): boolean {
  return (
    method === "POST" ||
    method === "PUT" ||
    method === "PATCH" ||
    method === "DELETE"
  );
}

/**
 * Maps `/api/*` requests to a coarse rate-limit bucket. Returns null when no limit applies.
 */
export function rateLimitBucketForApiRequest(
  pathname: string,
  method: string,
): RateLimitBucket | null {
  if (!mutatingMethod(method)) {
    return null;
  }

  if (pathname.startsWith("/api/internal")) {
    return "internal";
  }

  if (
    pathname === "/api/auth/setup" ||
    pathname === "/api/auth/recovery/request" ||
    pathname === "/api/me/resend-verification" ||
    pathname === "/api/me/email-change/request"
  ) {
    return "email_outbound";
  }

  if (
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/auth/recovery/confirm" ||
    pathname === "/api/auth/verify-email" ||
    pathname === "/api/auth/verify-email-change"
  ) {
    return "auth";
  }

  if (pathname === "/api/me/listen-data") {
    return "destructive";
  }

  if (pathname === "/api/me" && method === "DELETE") {
    return "destructive";
  }

  if (pathname === "/api/me/step-up") {
    return "sensitive_post";
  }

  if (pathname === "/api/imports" && method === "POST") {
    return "sensitive_post";
  }

  if (pathname === "/api/export/listens" && method === "POST") {
    return "sensitive_post";
  }

  return null;
}

function limitsForBucket(
  bucket: RateLimitBucket,
  env: AbuseEnvFields,
): { max: number; windowMs: number } {
  switch (bucket) {
    case "auth":
      return {
        max: env.VS_API_RATE_LIMIT_AUTH_MAX,
        windowMs: env.VS_API_RATE_LIMIT_AUTH_WINDOW_MS,
      };
    case "email_outbound":
      return {
        max: env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_MAX,
        windowMs: env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_WINDOW_MS,
      };
    case "sensitive_post":
      return {
        max: env.VS_API_RATE_LIMIT_SENSITIVE_POST_MAX,
        windowMs: env.VS_API_RATE_LIMIT_SENSITIVE_POST_WINDOW_MS,
      };
    case "destructive":
      return {
        max: env.VS_API_RATE_LIMIT_DESTRUCTIVE_MAX,
        windowMs: env.VS_API_RATE_LIMIT_DESTRUCTIVE_WINDOW_MS,
      };
    case "internal":
      return {
        max: env.VS_API_RATE_LIMIT_INTERNAL_MAX,
        windowMs: env.VS_API_RATE_LIMIT_INTERNAL_WINDOW_MS,
      };
  }
}

function rateLimitedJsonResponse(retryAfterMs: number): NextResponse {
  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const res = NextResponse.json(
    {
      error: "Too many requests",
      code: "rate_limited",
    },
    { status: 429 },
  );
  res.headers.set("Retry-After", String(retryAfterSec));
  return res;
}

export function rateLimitResponseIfExceeded(
  request: NextRequest,
  env: AbuseEnvFields,
  nowMs: number = Date.now(),
  trustProxyHeaders: boolean = false,
): NextResponse | null {
  const bucket = rateLimitBucketForApiRequest(request.nextUrl.pathname, request.method);
  if (!bucket) {
    return null;
  }

  const { max, windowMs } = limitsForBucket(bucket, env);
  const ip = clientIp(request, trustProxyHeaders);
  const key = `${bucket}:${ip}`;
  const pathname = request.nextUrl.pathname;
  const decision = consumeFixedWindowToken({ key, max, windowMs, nowMs });
  if (decision.ok) {
    if (
      bucket === "email_outbound" &&
      max > 1 &&
      decision.countInWindow === max
    ) {
      logEmailOutboundAbuseSignal({
        kind: "window_cap_reached",
        pathname,
        clientIp: ip,
        max,
        windowMs,
      });
    }
    return null;
  }
  if (bucket === "email_outbound") {
    logEmailOutboundAbuseSignal({
      kind: "rate_limited",
      pathname,
      clientIp: ip,
      max,
      windowMs,
      retryAfterMs: decision.retryAfterMs,
    });
  }
  return rateLimitedJsonResponse(decision.retryAfterMs);
}
