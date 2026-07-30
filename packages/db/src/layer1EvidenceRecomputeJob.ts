import { LAYER1_RECOMPUTE_MAX_CONSECUTIVE_FAILURES_DEFAULT } from "@vs/domain";
import type { Layer1EvidenceRecomputeEnqueueReasonCode } from "@vs/queue";

import type { DashboardAnalyticsDbExecutor } from "./dashboardAnalytics.js";
import {
  recomputeArtistUserRelationshipLayer1ForUser30dTop,
  summarizeArtistOutcomes,
} from "./artistUserRelationshipLayer1Recompute.js";
import { finalizeLayer1SignalRun, insertLayer1SignalRunRunning } from "./layer1SignalRun.js";
import { sanitizeLayer1RecomputeFailureMessageForPersistence } from "./layer1RecomputeFailureSanitize.js";
import {
  acknowledgeLayer1UserRecomputeStillFresh,
  finalizeLayer1UserRecomputeFailed,
  finalizeLayer1UserRecomputeFresh,
  finalizeLayer1UserRecomputeNeverComputed,
  getLayer1UserRecomputeStateRow,
  markLayer1UserRecomputeRunning,
  queryLayer1InputWatermarkForUser,
  shouldSkipLayer1UserEvidenceRecompute,
  upsertLayer1UserRecomputeQueuedForUsers,
} from "./layer1UserRecomputeState.js";

/** Explicit list (one or many users) or a bounded cursor page over `users.id`. */
export type Layer1EvidenceRecomputeScope =
  | { kind: "explicit_user_ids"; userIds: readonly string[] }
  | { kind: "user_cursor_batch"; cursorAfterUserId: string | null; limit: number };

export type Layer1EvidenceRecomputeUserRollup = Readonly<{
  userId: string;
  userSkipped: "no_30d_anchor_window" | null;
  success: number;
  skip: number;
  insufficiency: number;
  failure: number;
  userHardError: string | null;
}>;

export type Layer1EvidenceRecomputeJobResult = Readonly<{
  layer1SignalRunId: string;
  resolvedUserIds: readonly string[];
  userRollups: readonly Layer1EvidenceRecomputeUserRollup[];
  totals: Readonly<{
    success: number;
    skip: number;
    insufficiency: number;
    failure: number;
    usersWithHardError: number;
  }>;
  runStatus: "succeeded" | "failed";
}>;

const NULL_UUID_CURSOR = "00000000-0000-0000-0000-000000000000";

export async function listUserIdsForLayer1CursorBatch(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{ cursorAfterUserId: string | null; limit: number }>,
): Promise<readonly string[]> {
  const cursor = input.cursorAfterUserId ?? NULL_UUID_CURSOR;
  const { rows } = await db.query<{ id: string }>(
    `select id::text as id
       from users
      where id > $1::uuid
      order by id asc
      limit $2::int`,
    [cursor, input.limit],
  );
  return rows.map((r) => r.id);
}

function resolveUserIdsForScope(
  db: DashboardAnalyticsDbExecutor,
  scope: Layer1EvidenceRecomputeScope,
): Promise<readonly string[]> {
  if (scope.kind === "explicit_user_ids") {
    const deduped = [...new Set(scope.userIds)];
    return Promise.resolve(deduped);
  }
  return listUserIdsForLayer1CursorBatch(db, {
    cursorAfterUserId: scope.cursorAfterUserId,
    limit: scope.limit,
  });
}

/**
 * VS-50 — orchestrates Layer 1 evidence recomputation for `artist.user_relationship.v1`
 * within the existing rolling 30d window contract, records a `layer1_signal_runs` row,
 * and returns per-user rollups for structured logging.
 *
 * Safe rerun: evidence upserts are idempotent; BullMQ retries re-execute the same scope.
 *
 * Work is bounded per job by queue scope limits, per-user top-artist fan-out, and a
 * per-user+artist window play row cap in `recomputeArtistUserRelationshipLayer1ForUser30dTop`
 * (see `docs/performance/vs-56-layer1-performance-and-failure-modes.md`).
 */
export async function runLayer1EvidenceRecomputeJob(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{
    nowMs: number;
    scope: Layer1EvidenceRecomputeScope;
    triggerKind: string;
    enqueueReason: Layer1EvidenceRecomputeEnqueueReasonCode;
    correlationId?: string | null;
    actorUserId?: string | null;
    artistLimit?: number;
    bullmqJobId?: string | null;
    /**
     * VS-84 — persisted consecutive failure cap before `failed_exhausted`. Worker supplies
     * {@link ServerEnv.LAYER1_RECOMPUTE_MAX_CONSECUTIVE_FAILURES}; tests may override low.
     */
    maxConsecutiveFailures?: number;
  }>,
): Promise<Layer1EvidenceRecomputeJobResult> {
  const maxConsecutiveFailures =
    input.maxConsecutiveFailures ?? LAYER1_RECOMPUTE_MAX_CONSECUTIVE_FAILURES_DEFAULT;
  const resolvedUserIds = await resolveUserIdsForScope(db, input.scope);
  const contextJson = {
    scope: input.scope,
    now_ms_anchor: input.nowMs,
    bullmq_job_id: input.bullmqJobId ?? null,
    resolved_user_count: resolvedUserIds.length,
    enqueue_reason: input.enqueueReason,
  };

  const runId = await insertLayer1SignalRunRunning(db, {
    triggerKind: input.triggerKind,
    correlationId: input.correlationId ?? null,
    actorUserId: input.actorUserId ?? null,
    contextJson,
  });

  await upsertLayer1UserRecomputeQueuedForUsers(db, resolvedUserIds);

  const userRollups: Layer1EvidenceRecomputeUserRollup[] = [];
  let totals = { success: 0, skip: 0, insufficiency: 0, failure: 0, usersWithHardError: 0 };
  let anyFailure = false;

  try {
    for (const userId of resolvedUserIds) {
      try {
        const currentInputWatermark = await queryLayer1InputWatermarkForUser(db, userId);
        const priorState = await getLayer1UserRecomputeStateRow(db, userId);
        if (shouldSkipLayer1UserEvidenceRecompute(priorState, currentInputWatermark)) {
          await acknowledgeLayer1UserRecomputeStillFresh(db, {
            userId,
            inputWatermark: currentInputWatermark,
          });
          userRollups.push({
            userId,
            userSkipped: null,
            success: 0,
            skip: 0,
            insufficiency: 0,
            failure: 0,
            userHardError: null,
          });
          continue;
        }

        await markLayer1UserRecomputeRunning(db, userId);
        const perUser = await recomputeArtistUserRelationshipLayer1ForUser30dTop(db, {
          userId,
          nowMs: input.nowMs,
          artistLimit: input.artistLimit,
          layer1SignalRunId: runId,
        });
        if (perUser.userSkipped === "no_30d_anchor_window") {
          await finalizeLayer1UserRecomputeNeverComputed(db, userId);
          userRollups.push({
            userId,
            userSkipped: "no_30d_anchor_window",
            success: 0,
            skip: 0,
            insufficiency: 0,
            failure: 0,
            userHardError: null,
          });
          continue;
        }
        const tier = summarizeArtistOutcomes(perUser.artistOutcomes);
        totals = {
          success: totals.success + tier.success,
          skip: totals.skip + tier.skip,
          insufficiency: totals.insufficiency + tier.insufficiency,
          failure: totals.failure + tier.failure,
          usersWithHardError: totals.usersWithHardError,
        };
        if (tier.failure > 0) {
          anyFailure = true;
          await finalizeLayer1UserRecomputeFailed(db, {
            userId,
            failureCode: "layer1_partial_signal_failure",
            failureMessage: `artist tier totals=${JSON.stringify(tier)}`,
            maxConsecutiveFailures,
          });
        } else {
          const inputWatermark = await queryLayer1InputWatermarkForUser(db, userId);
          await finalizeLayer1UserRecomputeFresh(db, { userId, inputWatermark });
        }
        userRollups.push({
          userId,
          userSkipped: null,
          success: tier.success,
          skip: tier.skip,
          insufficiency: tier.insufficiency,
          failure: tier.failure,
          userHardError: null,
        });
      } catch (err) {
        anyFailure = true;
        totals = { ...totals, usersWithHardError: totals.usersWithHardError + 1 };
        const raw =
          err instanceof Error
            ? `${err.name}: ${err.message}`
            : `non_error: ${String(err)}`;
        const forDb = sanitizeLayer1RecomputeFailureMessageForPersistence(
          raw,
          "layer1_user_hard_error",
        );
        const rollupMsg =
          forDb != null && forDb.length > 2000 ? `${forDb.slice(0, 1990)}…[truncated]` : forDb;
        await finalizeLayer1UserRecomputeFailed(db, {
          userId,
          failureCode: "layer1_user_hard_error",
          failureMessage: forDb,
          maxConsecutiveFailures,
        });
        userRollups.push({
          userId,
          userSkipped: null,
          success: 0,
          skip: 0,
          insufficiency: 0,
          failure: 0,
          userHardError: rollupMsg,
        });
      }
    }

    const runStatus = anyFailure ? "failed" : "succeeded";
    await finalizeLayer1SignalRun(db, {
      runId,
      status: runStatus,
      errorCode: anyFailure ? "layer1_recompute_partial_or_hard_failure" : null,
      errorDetail: anyFailure
        ? `aggregate_failure totals=${JSON.stringify(totals)}`
        : null,
    });

    return {
      layer1SignalRunId: runId,
      resolvedUserIds,
      userRollups,
      totals,
      runStatus,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finalizeLayer1SignalRun(db, {
      runId,
      status: "failed",
      errorCode: "layer1_recompute_orchestrator_exception",
      errorDetail: msg.length > 4000 ? `${msg.slice(0, 3990)}…[truncated]` : msg,
    });
    throw err;
  }
}
