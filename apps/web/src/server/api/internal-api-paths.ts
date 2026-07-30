/**
 * Prefix for HTTP routes that use **privileged non-session** auth (Bearer secret),
 * not the browser session cookie. Keep in sync with `docs/security-architecture.md`.
 *
 * Edge middleware skips the session-cookie prefilter for this prefix; handlers must
 * call `requireInternalApiAuth` before performing work.
 */
export const INTERNAL_API_PATH_PREFIX = "/api/internal/" as const;

export function isInternalApiPathname(pathname: string): boolean {
  return pathname.startsWith(INTERNAL_API_PATH_PREFIX);
}
