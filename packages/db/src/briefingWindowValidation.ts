import type { DashboardListenSummary } from "./dashboardAnalytics.js";

/** Upper bound for a single rolling 7-day window; catches mis-anchored or cumulative totals. */
const DEFAULT_MAX_PLAUSIBLE_SEVEN_DAY_SCRBBLES = 4000;

/**
 * Returns true when a rolling 7-day {@link DashboardListenSummary} looks safe for prose
 * (year-ago and week-over-week comparisons).
 */
export function isPlausibleRollingSevenDayListenSummary(
  summary: Pick<DashboardListenSummary, "range" | "total_scrobbles">,
  options?: Readonly<{ maxTotal?: number }>,
): boolean {
  if (summary.range !== "7d") {
    return false;
  }
  const maxTotal = options?.maxTotal ?? DEFAULT_MAX_PLAUSIBLE_SEVEN_DAY_SCRBBLES;
  const n = summary.total_scrobbles;
  return Number.isFinite(n) && n >= 0 && n <= maxTotal;
}
