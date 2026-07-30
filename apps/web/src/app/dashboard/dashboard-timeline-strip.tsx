import type { DashboardHeroTimelinePoint } from "@vs/db";

/**
 * Thin vertical strokes sized by relative volume across the selected window (dense UTC days, or
 * UTC months for all-time).
 */
export function DashboardTimelineStrip({
  grain,
  points,
}: Readonly<{
  grain: "utc_day" | "utc_month";
  points: readonly DashboardHeroTimelinePoint[];
}>) {
  if (points.length === 0) {
    return (
      <p className="font-mono text-caption uppercase tracking-[0.06em] text-muted">
        No plays in this window to chart.
      </p>
    );
  }
  const max = Math.max(1, ...points.map((p) => p.count));
  const footer =
    grain === "utc_month"
      ? "Monthly volume in this window (UTC, up to 60 most recent months)"
      : "Daily volume in this window (UTC, every calendar day in range)";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-28 items-end gap-px border-b border-hairline pb-1">
        {points.map(({ period_start, count }) => {
          const px = 4 + Math.round((count / max) * 88);
          return (
            <div
              key={period_start}
              className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-end"
              title={`${period_start}: ${count}`}
            >
              <div
                className="w-px bg-brand/80"
                style={{ height: `${px}px` }}
              />
            </div>
          );
        })}
      </div>
      <p className="font-mono text-caption uppercase tracking-[0.06em] text-muted">{footer}</p>
    </div>
  );
}
