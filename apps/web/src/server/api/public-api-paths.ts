/**
 * Folder segments under `src/app/api` for routes that skip the edge session-cookie gate.
 * Keep in sync with `PUBLIC_API_PATHNAMES` (derived below).
 */
export const PUBLIC_API_ROUTE_SEGMENTS = [
  "auth/login",
  "auth/setup",
  "auth/logout",
  "auth/recovery/request",
  "auth/recovery/confirm",
  "auth/verify-email",
  "auth/verify-email-change",
  "public/analytics/archive-listens",
  "public/analytics/window-total",
  "public/analytics/summary",
] as const;

/**
 * App Router JSON routes that skip the edge session-cookie gate.
 * Handlers still perform their own work (e.g. logout clears an existing cookie when present).
 * All other `/api/*` traffic must carry a session cookie before hitting route code.
 */
export const PUBLIC_API_PATHNAMES = PUBLIC_API_ROUTE_SEGMENTS.map(
  (seg) => `/api/${seg}`,
);

const PUBLIC_SET = new Set(PUBLIC_API_PATHNAMES);

export function isPublicApiPathname(pathname: string): boolean {
  return PUBLIC_SET.has(pathname);
}
