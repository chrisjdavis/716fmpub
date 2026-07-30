import type { NextRequest } from "next/server";
import { AUTH_SESSION_COOKIE_NAME } from "@vs/domain/auth-session-cookie";
import { apiAuthenticationRequiredJson } from "@/server/api/api-auth-response";
import { isInternalApiPathname } from "@/server/api/internal-api-paths";
import { isPublicApiPathname } from "@/server/api/public-api-paths";

/**
 * Edge cookie **prefilter** only (not Postgres session validation).
 * Rejects `/api/*` requests when the session cookie is missing or blank, before route handlers run.
 * Forgery or stale tokens still reach the route and fail with the same 401 JSON inside
 * `withApiSession` / `validateSession` — see `docs/security-architecture.md`.
 */
export function sessionCookieGateResponse(
  request: NextRequest,
): ReturnType<typeof apiAuthenticationRequiredJson> | null {
  if (request.method === "OPTIONS") {
    return null;
  }
  const { pathname } = request.nextUrl;
  if (isPublicApiPathname(pathname) || isInternalApiPathname(pathname)) {
    return null;
  }
  const raw = request.cookies.get(AUTH_SESSION_COOKIE_NAME)?.value;
  if (!raw?.trim()) {
    return apiAuthenticationRequiredJson();
  }
  return null;
}
