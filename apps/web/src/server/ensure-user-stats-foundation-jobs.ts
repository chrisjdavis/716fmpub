import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import {
  backfillUserListenDailyMetricsFromListens,
  enqueueLayer1EvidenceRecomputeForUserBestEffort,
  getUserListenStatsFoundationReadiness,
} from "@vs/db";
import { enqueueDashboardBundleAnalyticsForUserBestEffort } from "@vs/queue";

/**
 * When the user has canonical listens but rollup tables (including `user_listen_daily_metrics`)
 * are still empty or were never backfilled after a new table shipped, either runs a direct daily
 * backfill (when other rollups already exist) or enqueues the dashboard bundle + listen period
 * metrics jobs (coalesced in Redis). Idempotent for repeat requests while the worker has not
 * finished.
 */
export async function ensureUserStatsFoundationJobsIfNeeded(
  pool: Pool,
  env: ServerEnv,
  userId: string,
): Promise<{ statsFoundationPending: boolean }> {
  const readiness = await getUserListenStatsFoundationReadiness(pool, userId);
  const statsFoundationReady =
    readiness.periodRollupsPopulated &&
    readiness.artistRollupsPopulated &&
    readiness.dailyMetricsPopulated;
  if (!readiness.hasListens || statsFoundationReady) {
    return { statsFoundationPending: false };
  }

  if (
    readiness.periodRollupsPopulated &&
    readiness.artistRollupsPopulated &&
    !readiness.dailyMetricsPopulated
  ) {
    await backfillUserListenDailyMetricsFromListens(pool, userId);
    return { statsFoundationPending: false };
  }

  await enqueueDashboardBundleAnalyticsForUserBestEffort(env, userId);
  await enqueueLayer1EvidenceRecomputeForUserBestEffort({
    env,
    db: pool,
    userId,
    reason: "import_completed",
  });
  return { statsFoundationPending: true };
}
