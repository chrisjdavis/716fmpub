/**
 * VS-77 — Layer 1 enqueue orchestration intentionally lives in `@vs/db` and imports `@vs/queue`
 * producers so product lifecycle code has one import surface. This creates a package edge
 * (persistence → queue); extraction to a dedicated orchestration package is deferred until a
 * second consumer needs the same split.
 */
import type { JobsOptions, Queue } from "bullmq";
import type { ServerEnv } from "@vs/env";
import { isRedisQueuesEnabled } from "@vs/env";
import {
  ADVANCED_ENTITLEMENT_REQUIRED_CODE,
  parseProductPlan,
  requireAdvancedEntitlement,
  type ProductPlan,
} from "@vs/domain";
import {
  createAnalyticsQueue,
  enqueueLayer1EvidenceRecomputeExplicitUsers,
  logQueueActivity,
  summarizeFailure,
  VS_QUEUE_NAMES,
  type FailureSummary,
  type Layer1EvidenceRecomputeEnqueueReasonCode,
} from "@vs/queue";

import type { DashboardAnalyticsDbExecutor } from "./dashboardAnalytics.js";
import {
  acknowledgeLayer1UserRecomputeStillFresh,
  getLayer1UserRecomputeStateRow,
  queryLayer1InputWatermarkForUser,
  resetLayer1UserRecomputeRetryBudgetFromExhausted,
  shouldSkipLayer1UserEvidenceRecompute,
  upsertLayer1UserRecomputeQueuedForUsers,
} from "./layer1UserRecomputeState.js";

/** VS-78 — re-exported queue contract: closed vocabulary for Layer 1 enqueue provenance. */
export type Layer1EvidenceRecomputeEnqueueReason = Layer1EvidenceRecomputeEnqueueReasonCode;

/** Reasons allowed to reset VS-84 exhaustion and enqueue another full failure budget. */
const LAYER1_ENQUEUE_BYPASS_EXHAUSTION_REASONS = new Set<Layer1EvidenceRecomputeEnqueueReasonCode>([
  "admin_manual",
  "internal_backfill",
  "signal_version_changed",
  "advanced_upgrade",
]);

type OverrideApplied = Readonly<{ internalEntitlementOverrideApplied?: true }>;

export type EnqueueLayer1EvidenceRecomputeForUserResult =
  | (Readonly<{
      outcome: "enqueued";
      userId: string;
      reason: Layer1EvidenceRecomputeEnqueueReason;
    }> &
      OverrideApplied)
  | (Readonly<{
      outcome: "skipped_not_entitled";
      userId: string;
      reason: Layer1EvidenceRecomputeEnqueueReason;
      code: typeof ADVANCED_ENTITLEMENT_REQUIRED_CODE;
    }> &
      OverrideApplied)
  | (Readonly<{
      outcome: "skipped_already_fresh";
      userId: string;
      reason: Layer1EvidenceRecomputeEnqueueReason;
    }> &
      OverrideApplied)
  | (Readonly<{
      outcome: "skipped_user_not_found";
      userId: string;
      reason: Layer1EvidenceRecomputeEnqueueReason;
    }> &
      OverrideApplied)
  | (Readonly<{
      outcome: "skipped_redis_disabled";
      userId: string;
      reason: Layer1EvidenceRecomputeEnqueueReason;
    }> &
      OverrideApplied)
  | (Readonly<{
      outcome: "skipped_retry_exhausted";
      userId: string;
      reason: Layer1EvidenceRecomputeEnqueueReason;
    }> &
      OverrideApplied)
  | (Readonly<{
      outcome: "enqueue_redis_failed";
      userId: string;
      reason: Layer1EvidenceRecomputeEnqueueReason;
      failure: FailureSummary;
    }> &
      OverrideApplied);

export type EnqueueLayer1EvidenceRecomputeForUserInput = Readonly<{
  db: DashboardAnalyticsDbExecutor;
  queue: Queue;
  userId: string;
  reason: Layer1EvidenceRecomputeEnqueueReason;
  now?: Date;
  correlationId?: string;
  actorUserId?: string;
  artistLimit?: number;
  jobsOptions?: JobsOptions;
  /**
   * Skips Advanced entitlement checks (operator backfills, admin repair). Product lifecycle
   * callers must omit this so Core users cannot enqueue Layer 1 work by mistake.
   */
  internalEntitlementOverride?: boolean;
}>;

async function queryUserProductPlanForLayer1Enqueue(
  db: DashboardAnalyticsDbExecutor,
  userId: string,
): Promise<{ found: false } | { found: true; productPlan: ProductPlan }> {
  const { rows } = await db.query<{ product_plan: string | null }>(
    `select product_plan::text as product_plan from users where id = $1::uuid`,
    [userId],
  );
  const raw = rows[0]?.product_plan;
  if (raw == null) {
    return { found: false };
  }
  const parsed = parseProductPlan(String(raw));
  return { found: true, productPlan: parsed ?? "core" };
}

function withOverrideTrace(
  internalEntitlementOverride: boolean | undefined,
  result: EnqueueLayer1EvidenceRecomputeForUserResult,
): EnqueueLayer1EvidenceRecomputeForUserResult {
  if (internalEntitlementOverride) {
    return { ...result, internalEntitlementOverrideApplied: true };
  }
  return result;
}

function lifecycleCorrelationId(
  reason: Layer1EvidenceRecomputeEnqueueReason,
  explicit?: string,
): string | undefined {
  if (explicit != null && explicit.length > 0) {
    return explicit.length > 256 ? explicit.slice(0, 256) : explicit;
  }
  const base = `lifecycle:${reason}`;
  return base.length > 256 ? base.slice(0, 256) : base;
}

/**
 * Central Layer 1 evidence enqueue entrypoint: entitlement, freshness short-circuit, queued
 * state upsert, then a single-user `layer1_evidence_recompute` job. The analytics producer
 * applies a stable BullMQ `jobId` per user so duplicate publishes coalesce in Redis; the worker
 * additionally no-ops per user when evidence is already fresh for the input watermark.
 */
export async function enqueueLayer1EvidenceRecomputeForUser(
  input: EnqueueLayer1EvidenceRecomputeForUserInput,
): Promise<EnqueueLayer1EvidenceRecomputeForUserResult> {
  const {
    db,
    queue,
    userId,
    reason,
    now,
    correlationId,
    actorUserId,
    artistLimit,
    jobsOptions,
    internalEntitlementOverride,
  } = input;

  const planRow = await queryUserProductPlanForLayer1Enqueue(db, userId);
  if (!planRow.found) {
    return withOverrideTrace(internalEntitlementOverride, {
      outcome: "skipped_user_not_found",
      userId,
      reason,
    });
  }

  if (!internalEntitlementOverride) {
    const ent = requireAdvancedEntitlement({ productPlan: planRow.productPlan });
    if (!ent.ok) {
      return withOverrideTrace(internalEntitlementOverride, {
        outcome: "skipped_not_entitled",
        userId,
        reason,
        code: ent.code,
      });
    }
  }

  const currentInputWatermark = await queryLayer1InputWatermarkForUser(db, userId);
  const priorState = await getLayer1UserRecomputeStateRow(db, userId);
  if (priorState?.status === "failed_exhausted") {
    if (!LAYER1_ENQUEUE_BYPASS_EXHAUSTION_REASONS.has(reason)) {
      return withOverrideTrace(internalEntitlementOverride, {
        outcome: "skipped_retry_exhausted",
        userId,
        reason,
      });
    }
    await resetLayer1UserRecomputeRetryBudgetFromExhausted(db, userId);
  }
  const priorAfterExhaustionReset =
    priorState?.status === "failed_exhausted"
      ? await getLayer1UserRecomputeStateRow(db, userId)
      : priorState;
  if (shouldSkipLayer1UserEvidenceRecompute(priorAfterExhaustionReset, currentInputWatermark)) {
    await acknowledgeLayer1UserRecomputeStillFresh(db, {
      userId,
      inputWatermark: currentInputWatermark,
    });
    return withOverrideTrace(internalEntitlementOverride, {
      outcome: "skipped_already_fresh",
      userId,
      reason,
    });
  }

  await upsertLayer1UserRecomputeQueuedForUsers(db, [userId]);

  const mergedJobsOptions: JobsOptions = {
    removeOnComplete: true,
    ...jobsOptions,
  };

  await enqueueLayer1EvidenceRecomputeExplicitUsers(queue, {
    userIds: [userId],
    enqueueReason: reason,
    now,
    correlationId: lifecycleCorrelationId(reason, correlationId),
    actorUserId,
    artistLimit,
    jobsOptions: mergedJobsOptions,
  });

  return withOverrideTrace(internalEntitlementOverride, { outcome: "enqueued", userId, reason });
}

export type EnqueueLayer1EvidenceRecomputeForUserBestEffortInput = Readonly<
  Omit<EnqueueLayer1EvidenceRecomputeForUserInput, "queue"> & {
    env: ServerEnv;
  }
>;

/**
 * Opens the analytics queue, runs {@link enqueueLayer1EvidenceRecomputeForUser}, logs and
 * swallows Redis failures (mirrors dashboard bundle best-effort producers).
 */
export async function enqueueLayer1EvidenceRecomputeForUserBestEffort(
  input: EnqueueLayer1EvidenceRecomputeForUserBestEffortInput,
): Promise<EnqueueLayer1EvidenceRecomputeForUserResult> {
  const {
    env,
    db,
    userId,
    reason,
    now,
    correlationId,
    actorUserId,
    artistLimit,
    jobsOptions,
    internalEntitlementOverride,
  } = input;
  if (!isRedisQueuesEnabled(env)) {
    return withOverrideTrace(internalEntitlementOverride, {
      outcome: "skipped_redis_disabled",
      userId,
      reason,
    });
  }
  const queue = createAnalyticsQueue(env);
  try {
    try {
      return await enqueueLayer1EvidenceRecomputeForUser({
        db,
        queue,
        userId,
        reason,
        now,
        correlationId,
        actorUserId,
        artistLimit,
        jobsOptions,
        internalEntitlementOverride,
      });
    } catch (err) {
      const failure = summarizeFailure(err);
      logQueueActivity({
        level: "warn",
        event: "producer_enqueue_failed",
        queue: VS_QUEUE_NAMES.ANALYTICS,
        userId,
        detail: { step: "layer1_evidence_recompute", reason },
        failure,
      });
      return withOverrideTrace(internalEntitlementOverride, {
        outcome: "enqueue_redis_failed",
        userId,
        reason,
        failure,
      });
    }
  } finally {
    await queue.close();
  }
}
