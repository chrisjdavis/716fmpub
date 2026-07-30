import { AUTH_CSRF_COOKIE_NAME } from "@vs/domain/auth-csrf-cookie";

/** Picks the CSRF cookie value from `Set-Cookie` header lines. */
export function parseVsCsrfCookie(setCookieValues: readonly string[]): string | null {
  const prefix = `${AUTH_CSRF_COOKIE_NAME}=`;
  for (const line of setCookieValues) {
    const nameValue = line.split(";")[0]?.trim() ?? "";
    if (nameValue.startsWith(prefix)) {
      const raw = nameValue.slice(prefix.length);
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
