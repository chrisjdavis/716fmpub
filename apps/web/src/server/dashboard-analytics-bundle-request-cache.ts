import type { Pool } from "pg";
import { tryReadFreshDashboardAnalyticsBundle } from "@vs/db";
import { getOrCreateBundleReadPromiseForUser } from "@/server/dashboard-request-context";

/**
 * Single analytics-bundle snapshot read per dashboard navigation + user, shared by the primary
 * loader and deferred chunks (replaces independent tryReadFresh calls).
 */
export function readFreshDashboardAnalyticsBundleForRequest(
  pool: Pool,
  userId: string,
): ReturnType<typeof tryReadFreshDashboardAnalyticsBundle> {
  return getOrCreateBundleReadPromiseForUser(userId, () =>
    tryReadFreshDashboardAnalyticsBundle(pool, userId),
  );
}
