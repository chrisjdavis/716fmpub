import type { ServerEnv } from "@vs/env";
import {
  enqueueDashboardBundleAnalyticsForUserBestEffort,
  type EnqueueDashboardBundleAnalyticsForUserOptions,
} from "@vs/queue";

export async function enqueueDashboardAnalyticsAfterImport(
  env: ServerEnv,
  userId: string,
  options?: EnqueueDashboardBundleAnalyticsForUserOptions,
): Promise<void> {
  return enqueueDashboardBundleAnalyticsForUserBestEffort(env, userId, options);
}
