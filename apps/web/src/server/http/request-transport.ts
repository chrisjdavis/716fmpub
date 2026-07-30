/**
 * Proxy-aware HTTPS detection and Host normalization (Edge-safe).
 * When `trustProxy` is false, `x-forwarded-*` must not influence transport decisions.
 */

export function requestUsesHttps(
  nextUrl: URL,
  headers: Headers,
  trustProxy: boolean,
): boolean {
  if (nextUrl.protocol === "https:") {
    return true;
  }
  if (!trustProxy) {
    return false;
  }
  const fp = headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return fp === "https";
}

/**
 * Host header (or first `x-forwarded-host` when `trustProxy` is true) as sent by the edge.
 */
export function effectiveRequestHost(
  headers: Headers,
  trustProxy: boolean,
): string | null {
  const forwarded = trustProxy
    ? headers.get("x-forwarded-host")?.split(",")[0]?.trim()
    : undefined;
  const host = (forwarded && forwarded.length > 0
    ? forwarded
    : headers.get("host")?.trim()) ?? "";
  return host.length > 0 ? host : null;
}

/**
 * Normalizes a Host / `:authority` style value to `URL.host` form for comparison (scheme is only
 * used to parse IPv6 + port forms consistently).
 */
export function hostHeaderToUrlHost(hostHeader: string, scheme: "https" | "http"): string {
  const h = hostHeader.trim();
  if (!h) {
    return "";
  }
  try {
    return new URL(`${scheme}://${h}`).host.toLowerCase();
  } catch {
    return h.toLowerCase();
  }
}

export type OriginCheck = "absent" | "ok" | "mismatch";

export function originHeaderMatchesPublicApp(
  headers: Headers,
  publicAppOrigin: string,
): OriginCheck {
  const raw = headers.get("origin")?.trim();
  if (!raw || raw === "null") {
    return "absent";
  }
  try {
    const want = new URL(publicAppOrigin).origin;
    const got = new URL(raw).origin;
    return got === want ? "ok" : "mismatch";
  } catch {
    return "mismatch";
  }
}
