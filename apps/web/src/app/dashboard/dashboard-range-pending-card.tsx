import type { ReactNode } from "react";

const dashboardRangePendingCardBaseClass =
  "relative min-w-0 overflow-hidden rounded-md";

/** Layout wrapper for dashboard sections (keeps call sites stable). */
export function DashboardRangePendingCard({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <div className={[dashboardRangePendingCardBaseClass, className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
