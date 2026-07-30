import Link from "next/link";
import type { DashboardAnalyticsRange } from "@vs/db";

const SEGMENTS: ReadonlyArray<{
  value: DashboardAnalyticsRange;
  label: string;
  compactLabel: string;
  href: string;
}> = [
  { value: "7d", label: "7D", compactLabel: "7D", href: "/dashboard/explore" },
  { value: "30d", label: "30D", compactLabel: "30D", href: "/dashboard/explore" },
  { value: "90d", label: "90D", compactLabel: "90D", href: "/dashboard/explore" },
  { value: "all", label: "ALL TIME", compactLabel: "ALL", href: "/dashboard/explore" },
];

export function DashboardAnalyticsRangeSwitch({
  active,
  variant = "default",
}: Readonly<{
  active: DashboardAnalyticsRange;
  variant?: "default" | "compact";
}>) {
  const compact = variant === "compact";
  const stackClass = compact ? "flex justify-start" : "flex flex-col gap-3";
  const labelClass = "font-mono text-label uppercase tracking-[0.08em] text-overline";
  const tablistClass = compact
    ? "inline-flex max-w-full rounded-lg border border-brand p-1.5 font-mono text-caption uppercase leading-none tracking-[0.08em] ease-out duration-200"
    : "inline-flex w-full max-w-xl rounded-lg border border-brand p-1 font-mono text-label uppercase tracking-[0.1em] ease-out duration-200";
  const linkClass = compact
    ? "flex min-h-9 min-w-0 flex-1 items-center justify-center px-2.5 py-2 text-center no-underline hover:no-underline transition-[color,background-color] duration-200 ease-out sm:min-h-10 sm:px-3"
    : "flex min-h-[44px] min-w-0 flex-1 items-center justify-center px-2 py-2 text-center no-underline hover:no-underline transition-[color,background-color] duration-200 ease-out sm:px-3";

  return (
    <div className={stackClass}>
      {!compact ? <p className={labelClass}>Analytics window</p> : null}
      <div
        className={tablistClass}
        role="tablist"
        aria-label="Analytics time range"
      >
        {SEGMENTS.map((seg) => {
          const isActive = active === seg.value;
          return (
            <Link
              key={seg.value}
              href={seg.href}
              className={`${linkClass} ${
                isActive
                  ? "rounded-[0.25rem] bg-white text-neutral-950"
                  : "rounded-[0.25rem] text-muted hover:text-foreground"
              }`}
              aria-current={isActive ? "page" : undefined}
              scroll={false}
            >
              {compact ? seg.compactLabel : seg.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
