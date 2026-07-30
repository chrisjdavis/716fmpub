import { NextResponse } from "next/server";
import {
  parseDashboardAnalyticsRange,
  parseTimeMachineMonthYyyMm,
  utcCalendarMonthBoundsIso,
  type DashboardAnalyticsRange,
} from "@vs/db";

export type ParsedAnalyticsWindowQuery = Readonly<{
  monthKey: string | null;
  playedAtUtcWindow: ReturnType<typeof utcCalendarMonthBoundsIso>;
  hasMonth: boolean;
  effectiveRange: DashboardAnalyticsRange;
}>;

/**
 * Shared `range` / `month` parsing for analytics routes (matches `GET /api/analytics/summary`).
 */
export function parseAnalyticsWindowQuery(url: URL): ParsedAnalyticsWindowQuery | NextResponse {
  const monthRaw = url.searchParams.get("month");
  const monthKey =
    monthRaw !== null && String(monthRaw).trim() !== ""
      ? parseTimeMachineMonthYyyMm(String(monthRaw).trim())
      : null;
  const playedAtUtcWindow =
    monthKey !== null ? utcCalendarMonthBoundsIso(monthKey) : null;
  if (
    monthRaw !== null &&
    String(monthRaw).trim() !== "" &&
    (monthKey === null || playedAtUtcWindow === null)
  ) {
    return NextResponse.json(
      {
        error: "Invalid month",
        supported: "YYYY-MM (UTC calendar month)",
      },
      { status: 400 },
    );
  }
  const hasMonth = playedAtUtcWindow !== null;

  const range = parseDashboardAnalyticsRange(url.searchParams.get("range"));
  if (!hasMonth && !range) {
    return NextResponse.json(
      {
        error: "Invalid range",
        supported: ["7d", "30d", "90d", "all"],
      },
      { status: 400 },
    );
  }
  const effectiveRange = range ?? "all";

  return {
    monthKey,
    playedAtUtcWindow,
    hasMonth,
    effectiveRange,
  };
}
