import type { DashboardAnalyticsRange } from "@vs/db";
import { getPool } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { loadDashboardRecentListens } from "@/server/dashboard-page-data";
import { DashboardRangePendingCard } from "./dashboard-range-pending-card";
import { DashboardRecentTracksListBody } from "./dashboard-recent-tracks-list";

const dashboardPairedColumnCardClass = "flex h-full min-h-0 flex-col";
const dashboardPairedColumnBodyClass = "flex min-h-0 flex-1 flex-col";

const listLabelClass =
  "mb-4 font-mono text-label font-normal uppercase tracking-[0.1em] text-overline";

export function DashboardRecentTracksFallback() {
  return (
    <DashboardRangePendingCard className={dashboardPairedColumnCardClass}>
      <div className={dashboardPairedColumnBodyClass}>
        <h3 className={listLabelClass}>Recent tracks</h3>
        <p className="font-mono text-caption uppercase tracking-[0.06em] text-muted" aria-live="polite">
          [LOADING…]
        </p>
      </div>
    </DashboardRangePendingCard>
  );
}

export async function DashboardRecentTracksRsc({
  userId,
  range,
  allowAiLayer1Reads = false,
}: Readonly<{
  userId: string;
  range: DashboardAnalyticsRange;
  /** Must match session plan; bundle-backed recent rows require Advanced (VS-88). */
  allowAiLayer1Reads?: boolean;
}>) {
  const env = loadServerEnv();
  const pool = getPool(env);
  const recentListens = await loadDashboardRecentListens(pool, userId, range, {
    allowAiLayer1Reads,
  });
  return (
    <DashboardRangePendingCard className={dashboardPairedColumnCardClass}>
      <div className={dashboardPairedColumnBodyClass}>
        <DashboardRecentTracksListBody recentListens={recentListens} />
      </div>
    </DashboardRangePendingCard>
  );
}
