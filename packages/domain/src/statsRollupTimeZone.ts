/**
 * Resolves `users.stats_timezone` for SQL rollups (`AT TIME ZONE`) and local calendar buckets.
 * Invalid or empty values fall back to UTC so rollups never throw.
 */
export function coalesceStatsRollupTimeZoneIANA(statsTimezone: string | null | undefined): string {
  const raw = statsTimezone?.trim();
  if (!raw) {
    return "UTC";
  }
  try {
    Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date(0));
    return raw;
  } catch {
    return "UTC";
  }
}
