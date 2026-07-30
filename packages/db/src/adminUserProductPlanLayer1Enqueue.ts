import type { ServerEnv } from "@vs/env";

import type { DashboardAnalyticsDbExecutor } from "./dashboardAnalytics.js";
import {
  enqueueLayer1EvidenceRecomputeForUserBestEffort,
  type EnqueueLayer1EvidenceRecomputeForUserResult,
} from "./layer1EvidenceRecomputeEnqueue.js";

/**
 * After a successful admin transition Core → Advanced (`users.product_plan`), schedules a
 * full Layer 1 evidence recompute with provenance `advanced_upgrade`. Downgrades and no-op
 * plan PATCHes must not call this — Core accounts are not entitled to Layer 1 producers.
 */
export async function enqueueLayer1EvidenceRecomputeForAdminCoreToAdvancedUpgradeBestEffort(
  input: Readonly<{
    env: ServerEnv;
    db: DashboardAnalyticsDbExecutor;
    targetUserId: string;
    actorUserId: string;
  }>,
): Promise<EnqueueLayer1EvidenceRecomputeForUserResult> {
  const correlationId = `admin:product_plan:core_to_advanced:${input.targetUserId}`;
  return enqueueLayer1EvidenceRecomputeForUserBestEffort({
    env: input.env,
    db: input.db,
    userId: input.targetUserId,
    reason: "advanced_upgrade",
    actorUserId: input.actorUserId,
    correlationId: correlationId.length > 256 ? correlationId.slice(0, 256) : correlationId,
  });
}
