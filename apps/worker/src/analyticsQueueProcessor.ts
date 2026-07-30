import { UnrecoverableError, type Job } from "bullmq";
import {
  enqueueLayer1EvidenceRecomputeForUserBestEffort,
  recomputeDashboardAnalyticsBundle,
  recomputeUserListenPeriodMetrics,
  runLayer1EvidenceRecomputeJob,
} from "@vs/db";
import type { ServerEnv } from "@vs/env";
import type { Pool } from "pg";
import {
  ANALYTICS_QUEUE_JOB_NAME,
  parseAnalyticsWorkerJob,
  VsInvalidJobPayloadError,
  VS_QUEUE_NAMES,
  logQueueActivity,
} from "@vs/queue";

import { notifyWebAppListeningHistoryReadCacheInvalidationBestEffort } from "./webReadCacheInvalidation.js";
import { notifyWebAppOnboardingImportReadyBestEffort } from "./webOnboardingImportReadyNotification.js";

function asInvalidPayloadFailure(err: unknown): UnrecoverableError {
  if (err instanceof VsInvalidJobPayloadError) {
    return new UnrecoverableError(err.message);
  }
  throw err;
}

function logLayer1UserRollup(
  bullmqJobId: string,
  rollup: {
    userId: string;
    userSkipped: "no_30d_anchor_window" | null;
    success: number;
    skip: number;
    insufficiency: number;
    failure: number;
    userHardError: string | null;
  },
): void {
  const level = rollup.userHardError || rollup.failure > 0 ? "warn" : "info";
  logQueueActivity({
    level,
    event: "pipeline_progress",
    queue: VS_QUEUE_NAMES.ANALYTICS,
    bullmqJobId,
    jobName: ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE,
    userId: rollup.userId,
    detail: {
      layer1_user_skipped_no_window: rollup.userSkipped ? 1 : 0,
      layer1_success: rollup.success,
      layer1_skip: rollup.skip,
      layer1_insufficiency: rollup.insufficiency,
      layer1_failure: rollup.failure,
      layer1_user_hard_error: rollup.userHardError ? 1 : 0,
    },
  });
  if (rollup.userHardError) {
    console.warn(
      `[vs-worker:layer1_recompute] bullmq_job_id=${bullmqJobId} user_id=${rollup.userId} outcome=user_hard_error msg=${rollup.userHardError}`,
    );
  } else if (rollup.userSkipped) {
    console.warn(
      `[vs-worker:layer1_recompute] bullmq_job_id=${bullmqJobId} user_id=${rollup.userId} outcome=user_skip reason=${rollup.userSkipped}`,
    );
  } else {
    console.log(
      `[vs-worker:layer1_recompute] bullmq_job_id=${bullmqJobId} user_id=${rollup.userId} outcome=user_rollup success=${rollup.success} skip=${rollup.skip} insufficiency=${rollup.insufficiency} failure=${rollup.failure}`,
    );
  }
}

export async function processAnalyticsJob(
  job: Job,
  pool: Pool,
  env: ServerEnv,
): Promise<void> {
  let spec;
  try {
    spec = parseAnalyticsWorkerJob(job);
  } catch (err) {
    throw asInvalidPayloadFailure(err);
  }

  if (spec.name === ANALYTICS_QUEUE_JOB_NAME.LISTEN_PERIOD_METRICS) {
    const { userId, mode } = spec.data;
    await recomputeUserListenPeriodMetrics(pool, userId, { mode });
    await notifyWebAppListeningHistoryReadCacheInvalidationBestEffort(env, userId);
    await notifyWebAppOnboardingImportReadyBestEffort(env, userId);
    return;
  }

  if (spec.name === ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE) {
    const { nowMsAnchorIso, scope, enqueueReason, correlationId, actorUserId, artistLimit } =
      spec.data;
    const nowMs = Date.parse(nowMsAnchorIso);
    if (!Number.isFinite(nowMs)) {
      throw new UnrecoverableError(
        "analytics layer1_evidence_recompute: invalid nowMsAnchorIso",
      );
    }
    const bullmqJobId = String(job.id);
    const result = await runLayer1EvidenceRecomputeJob(pool, {
      nowMs,
      scope,
      triggerKind: "analytics_queue.layer1_evidence_recompute",
      enqueueReason,
      correlationId: correlationId ?? null,
      actorUserId: actorUserId ?? null,
      artistLimit,
      bullmqJobId,
      maxConsecutiveFailures: env.LAYER1_RECOMPUTE_MAX_CONSECUTIVE_FAILURES,
    });
    logQueueActivity({
      level: result.runStatus === "failed" ? "warn" : "info",
      event: "pipeline_progress",
      queue: VS_QUEUE_NAMES.ANALYTICS,
      bullmqJobId,
      jobName: spec.name,
      detail: {
        layer1_enqueue_reason: enqueueReason,
        layer1_signal_run_id_present: 1,
        layer1_resolved_users: result.resolvedUserIds.length,
        layer1_total_success: result.totals.success,
        layer1_total_skip: result.totals.skip,
        layer1_total_insufficiency: result.totals.insufficiency,
        layer1_total_failure: result.totals.failure,
        layer1_users_hard_error: result.totals.usersWithHardError,
        layer1_run_failed: result.runStatus === "failed" ? 1 : 0,
      },
    });
    console.log(
      `[vs-worker:layer1_recompute] bullmq_job_id=${bullmqJobId} phase=job_summary layer1_signal_run_id=${result.layer1SignalRunId} users=${result.resolvedUserIds.length} totals_success=${result.totals.success} totals_skip=${result.totals.skip} totals_insufficiency=${result.totals.insufficiency} totals_failure=${result.totals.failure} users_hard_error=${result.totals.usersWithHardError} run_status=${result.runStatus}`,
    );
    for (const r of result.userRollups) {
      logLayer1UserRollup(bullmqJobId, r);
    }
    if (result.runStatus === "failed") {
      throw new UnrecoverableError(
        `layer1_evidence_recompute finished with failures (layer1_signal_run_id=${result.layer1SignalRunId})`,
      );
    }
    return;
  }

  const { windowStartIso, windowEndIso, userId } = spec.data;
  if (!userId) {
    throw new UnrecoverableError(
      "analytics windowed_aggregate requires userId in this deployment (scope must not be inferred)",
    );
  }

  const startMs = Date.parse(windowStartIso);
  const endMs = Date.parse(windowEndIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new UnrecoverableError("analytics windowed_aggregate: invalid ISO window bounds");
  }
  if (endMs < startMs) {
    throw new UnrecoverableError(
      "analytics windowed_aggregate: windowEndIso must be >= windowStartIso",
    );
  }

  await recomputeDashboardAnalyticsBundle(pool, { userId, nowMs: endMs });
  await enqueueLayer1EvidenceRecomputeForUserBestEffort({
    env,
    db: pool,
    userId,
    reason: "listen_ingested",
    now: new Date(endMs),
  });
  await notifyWebAppListeningHistoryReadCacheInvalidationBestEffort(env, userId);
}
