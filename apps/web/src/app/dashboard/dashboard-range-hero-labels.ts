import type { DashboardAnalyticsRange } from "@vs/db";

/** Short label for the time-window hero (user-facing only). */
export function dashboardRangeOverviewKicker(range: DashboardAnalyticsRange): string {
  switch (range) {
    case "7d":
      return "Window · last 7 days";
    case "30d":
      return "Window · last 30 days";
    case "90d":
      return "Window · last 90 days";
    case "all":
      return "Window · all time";
  }
}

/** Line under the window play count (matches selected range). */
export function dashboardWindowPlaysCaption(range: DashboardAnalyticsRange): string {
  switch (range) {
    case "7d":
      return "Plays in the last 7 days";
    case "30d":
      return "Plays in the last 30 days";
    case "90d":
      return "Plays in the last 90 days";
    case "all":
      return "Plays across all imported history";
  }
}
