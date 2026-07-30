import type { DashboardHeroWindowMetrics, DashboardListenSummary } from "@vs/db";
import { DashboardAnalyticsRangeSwitch } from "./dashboard-analytics-range-switch";
import { DashboardRangePendingCard } from "./dashboard-range-pending-card";
import {
  dashboardRangeOverviewKicker,
  dashboardWindowPlaysCaption,
} from "./dashboard-range-hero-labels";
import { DashboardTimelineStrip } from "./dashboard-timeline-strip";
import { displayUtcWeekdayPeak, replayBehaviorFromSummary } from "./dashboard-window-behavior";
import { formatCount } from "./format-count";
import styles from "./dashboard-hero.module.css";

export function DashboardHero({
  summary,
  heroWindow,
}: Readonly<{
  summary: DashboardListenSummary;
  heroWindow: DashboardHeroWindowMetrics;
}>) {
  const activeDay = displayUtcWeekdayPeak(heroWindow.weekday_peak);
  const replay = replayBehaviorFromSummary(summary);

  return (
    <section aria-label="Listening overview">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          <div>
            <p className="font-mono text-label uppercase tracking-[0.1em] text-overline">Current window</p>
            <div className={`${styles.heroRangeCluster} mt-4`}>
              <DashboardAnalyticsRangeSwitch active={summary.range} variant="compact" />
            </div>
          </div>
          <div className="space-y-4 text-left">
            <p className={styles.label}>{dashboardRangeOverviewKicker(summary.range)}</p>
            <DashboardRangePendingCard>
              <p className={styles.displayNumber}>{formatCount(summary.total_scrobbles)}</p>
            </DashboardRangePendingCard>
            <p className="font-mono text-label uppercase tracking-[0.1em] text-muted">
              {dashboardWindowPlaysCaption(summary.range)}
            </p>
            <p className="max-w-xl font-sans text-body leading-relaxed text-muted">
              Use the time window first. Everything below uses the same filter so this page reads as
              one snapshot, not unrelated blocks.
            </p>
          </div>
        </div>

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-hairline bg-surface p-5">
            <p className="font-mono text-label uppercase tracking-[0.08em] text-overline">
              Most active day (UTC)
            </p>
            {activeDay ? (
              <>
                <p className="mt-3 font-sans text-heading font-medium text-display">{activeDay.name}</p>
                <p className="mt-2 font-sans text-caption text-muted">
                  {activeDay.count} plays on that weekday in this window (UTC)
                </p>
              </>
            ) : (
              <>
                <p className="mt-3 font-sans text-heading font-medium text-display">—</p>
                <p className="mt-2 font-sans text-caption text-muted">
                  No plays in this window yet.
                </p>
              </>
            )}
          </div>
          <div className="rounded-md border border-hairline bg-surface p-5">
            <p className="font-mono text-label uppercase tracking-[0.08em] text-overline">Replay behavior</p>
            <p className="mt-3 font-sans text-heading font-medium text-display">{replay.title}</p>
            <p className="mt-2 font-sans text-caption text-muted">{replay.subtitle}</p>
          </div>
          <div className="rounded-md border border-hairline bg-surface p-5 sm:col-span-2">
            <p className="font-mono text-label uppercase tracking-[0.08em] text-overline">Activity shape</p>
            <div className="mt-4">
              <DashboardTimelineStrip
                grain={heroWindow.timeline_grain}
                points={heroWindow.timeline}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
