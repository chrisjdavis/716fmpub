export function isValidIanaTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Prefer Vercel’s geo header when present; otherwise UTC. Used only for calendar labels and
 * day-bucket hero timelines on the home briefing (rolling totals stay on the server clock).
 */
export function inferBriefingTimeZoneFromHeaders(headers: Headers): string {
  const raw = headers.get("x-vercel-ip-timezone")?.trim();
  if (raw !== undefined && raw.length > 0 && isValidIanaTimeZone(raw)) {
    return raw;
  }
  return "UTC";
}

/** Saved profile wins over edge-inferred zone when it parses as a real IANA name. */
export function resolveBriefingIANATimeZoneFromProfileAndHeaders(
  profileStatsTimezone: string | null | undefined,
  headers: Headers,
): string {
  const t = profileStatsTimezone?.trim();
  if (t !== undefined && t.length > 0 && isValidIanaTimeZone(t)) {
    return t;
  }
  return inferBriefingTimeZoneFromHeaders(headers);
}
