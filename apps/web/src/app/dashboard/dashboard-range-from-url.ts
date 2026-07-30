import type { DashboardAnalyticsRange } from "@vs/db";

/**
 * Client-safe `range` query parsing aligned with {@link parseDashboardRangeSearchParam}
 * on the server (invalid / missing → default window).
 */
export function dashboardRangeFromSearchParam(raw: string | null): DashboardAnalyticsRange {
  if (raw === "7d" || raw === "30d" || raw === "90d" || raw === "all") {
    return raw;
  }
  return "30d";
}
