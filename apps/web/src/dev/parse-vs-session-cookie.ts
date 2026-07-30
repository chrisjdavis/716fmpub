/**
 * Picks the `vs_session` value from `Set-Cookie` header lines (e.g. from `Headers#getSetCookie()`).
 */
export function parseVsSessionCookie(
  setCookieValues: readonly string[],
): string | null {
  for (const line of setCookieValues) {
    const nameValue = line.split(";")[0]?.trim() ?? "";
    const prefix = "vs_session=";
    if (nameValue.startsWith(prefix)) {
      const value = nameValue.slice(prefix.length);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}
