import { AUTH_CSRF_COOKIE_NAME } from "@vs/domain/auth-csrf-cookie";
import { API_CSRF_HEADER_NAME } from "@vs/domain/auth-csrf-header";

/**
 * Reads the CSRF cookie set by the server (non-HttpOnly). Returns null when absent.
 */
export function readBrowserCsrfCookieValue(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const parts = document.cookie.split(";").map((p) => p.trim());
  const prefix = `${AUTH_CSRF_COOKIE_NAME}=`;
  for (const p of parts) {
    if (p.startsWith(prefix)) {
      const raw = p.slice(prefix.length);
      try {
        const decoded = decodeURIComponent(raw);
        return decoded.length > 0 ? decoded : null;
      } catch {
        return raw.length > 0 ? raw : null;
      }
    }
  }
  return null;
}

/**
 * Ensures a CSRF cookie exists by hitting a safe session endpoint when the cookie is missing
 * (for example legacy sessions issued before CSRF cookies existed).
 */
export async function ensureBrowserCsrfCookieValue(): Promise<string | null> {
  let v = readBrowserCsrfCookieValue();
  if (v) {
    return v;
  }
  const res = await fetch("/api/me", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) {
    return null;
  }
  return readBrowserCsrfCookieValue();
}

/**
 * Bootstraps `vs_csrf` for first-run setup (no session). Calls `GET /api/auth/setup`.
 */
export async function ensurePublicSetupCsrfCookieValue(): Promise<string | null> {
  let v = readBrowserCsrfCookieValue();
  if (v) {
    return v;
  }
  const res = await fetch("/api/auth/setup", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) {
    return null;
  }
  return readBrowserCsrfCookieValue();
}

export function csrfHeaderInitFromBrowserCookie(): Record<string, string> | undefined {
  const t = readBrowserCsrfCookieValue();
  return t ? { [API_CSRF_HEADER_NAME]: t } : undefined;
}

/** Header record for `fetch` after ensuring the CSRF cookie exists (may call `GET /api/me`). */
export async function browserCsrfHeaderRecord(): Promise<
  Record<string, string> | null
> {
  const t = await ensureBrowserCsrfCookieValue();
  return t ? { [API_CSRF_HEADER_NAME]: t } : null;
}
