import { NextResponse } from "next/server";
import type { ServerEnv } from "@vs/env";
import { consumeDistributedFixedWindowToken } from "@/server/api/distributed-rate-limit";

function clientIpFromRequest(req: Request, trustProxyHeaders: boolean): string {
  if (!trustProxyHeaders) {
    const vercel = req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
    if (vercel) {
      return vercel;
    }
    const fly = req.headers.get("fly-client-ip")?.trim();
    if (fly) {
      return fly;
    }
    return "unknown";
  }
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) {
    return cf;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }
  const xff = req.headers.get("x-forwarded-for")?.trim();
  if (xff && !xff.includes(",")) {
    // Only trust single-hop XFF (ingress overwrite). Multi-hop lists are spoofable.
    return xff;
  }
  const vercel = req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) {
    return vercel;
  }
  const fly = req.headers.get("fly-client-ip")?.trim();
  if (fly) {
    return fly;
  }
  return "unknown";
}

function rateLimitedJson(retryAfterMs: number): NextResponse {
  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const res = NextResponse.json(
    { error: "Too many requests", code: "rate_limited" },
    { status: 429 },
  );
  res.headers.set("Retry-After", String(retryAfterSec));
  return res;
}

/**
 * Shared Redis rate limit for auth-sensitive Node handlers (complements Edge in-memory limits).
 */
export async function rejectIfAuthAbuseRateLimited(
  req: Request,
  env: ServerEnv,
  bucket: "auth" | "email_outbound",
): Promise<NextResponse | null> {
  const ip = clientIpFromRequest(req, env.trustProxyHeaders);
  const max =
    bucket === "auth"
      ? env.VS_API_RATE_LIMIT_AUTH_MAX
      : env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_MAX;
  const windowMs =
    bucket === "auth"
      ? env.VS_API_RATE_LIMIT_AUTH_WINDOW_MS
      : env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_WINDOW_MS;
  const decision = await consumeDistributedFixedWindowToken({
    env,
    key: `${bucket}:${ip}`,
    max,
    windowMs,
  });
  if (decision.ok) {
    return null;
  }
  return rateLimitedJson(decision.retryAfterMs);
}
