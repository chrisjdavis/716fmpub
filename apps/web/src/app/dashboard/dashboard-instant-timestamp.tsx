"use client";

import { useDashboardDisplayIanaTimeZone } from "./dashboard-display-timezone-context";
import { formatDashboardTimestamp, formatDashboardTimestampHuman } from "./format-dashboard-timestamp";

export function DashboardInstantTimestamp({
  iso,
  variant,
  className,
}: Readonly<{
  iso: string;
  variant: "precise" | "human";
  className?: string;
}>) {
  const tz = useDashboardDisplayIanaTimeZone();
  const text =
    variant === "precise" ? formatDashboardTimestamp(iso, tz) : formatDashboardTimestampHuman(iso, tz);
  return <span className={className}>{text}</span>;
}
