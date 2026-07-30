import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import { enqueueLayer1EvidenceRecomputeForUserBestEffort } from "./layer1EvidenceRecomputeEnqueue.js";
import type { DashboardAnalyticsDbExecutor } from "./dashboardAnalytics.js";

/** Session-scoped advisory lock so only one worker runs a sweep at a time. */
const LAYER1_RECONCILE_LOCK_KEY1 = 978_301 as const;
const LAYER1_RECONCILE_LOCK_KEY2 = 83 as const;

export type Layer1ReconciliationSweepMetrics = Readonly<{
  ran: boolean;
  skipReason?: "lock_not_acquired";
  selectedUsers: number;
  enqueued: number;
  skippedAlreadyFresh: number;
  skippedRetryExhausted: number;
  skippedNotEntitled: number;
  skippedUserNotFound: number;
  skippedRedisDisabled: number;
  enqueueRedisFailed: number;
}>;

type Layer1ReconciliationSweepCounters = {
  selectedUsers: number;
  enqueued: number;
  skippedAlreadyFresh: number;
  skippedRetryExhausted: number;
  skippedNotEntitled: number;
  skippedUserNotFound: number;
  skippedRedisDisabled: number;
  enqueueRedisFailed: number;
};

function emptyCounters(): Layer1ReconciliationSweepCounters {
  return {
    selectedUsers: 0,
    enqueued: 0,
    skippedAlreadyFresh: 0,
    skippedRetryExhausted: 0,
    skippedNotEntitled: 0,
    skippedUserNotFound: 0,
    skippedRedisDisabled: 0,
    enqueueRedisFailed: 0,
  };
}

/**
 * Stable SQL listing Advanced accounts whose persisted Layer 1 state is missing, stale,
 * or failed (cooldown elapsed). Excludes `queued` / `running`. Core plans never appear
 * (`users.product_plan = 'advanced'` only).
 */
export async function listAdvancedUserIdsNeedingLayer1Reconciliation(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{
    activeSignalVersion: string;
    failedRetryCooldownSec: number;
    limit: number;
  }>,
): Promise<readonly string[]> {
  const { rows } = await db.query<{ user_id: string }>(
    `select u.id::text as user_id
       from users u
       left join layer1_user_recompute_state s on s.user_id = u.id
       cross join lateral (
         select (
           select max(x)
             from unnest(array[
               (select max(l.played_at) from listens l where l.user_id = u.id),
               (select max(l.created_at) from listens l where l.user_id = u.id),
               (select max(ij.updated_at)
                  from import_jobs ij
                 where ij.user_id = u.id
                   and ij.stage = 'completed')
             ]) as t(x)
         ) as current_input_watermark
       ) wm
      where u.product_plan = 'advanced'
        and (
          s.user_id is null
          or (
            s.status is distinct from 'queued'
            and s.status is distinct from 'running'
          )
        )
        and (
          s.user_id is null
          or s.status in ('never_computed', 'stale')
          or (
            s.status = 'failed'
            and (
              s.last_failed_at is null
              or s.last_failed_at <= now() - ($2::bigint * interval '1 second')
            )
          )
          or (
            s.status = 'fresh'
            and (
              s.signal_version is distinct from $1::text
              or (
                (wm.current_input_watermark is null and s.input_watermark is not null)
                or (wm.current_input_watermark is not null and s.input_watermark is null)
                or (
                  wm.current_input_watermark is not null
                  and s.input_watermark is not null
                  and wm.current_input_watermark > s.input_watermark
                )
              )
            )
          )
        )
      order by
        case
          when s.user_id is null then 1
          when s.status = 'failed' then 0
          when s.status = 'never_computed' then 1
          when s.status = 'stale' then 2
          else 3
        end,
        u.id::text
      limit $3::int`,
    [input.activeSignalVersion, input.failedRetryCooldownSec, input.limit],
  );
  return rows.map((r) => String(r.user_id));
}

function bump(
  m: Layer1ReconciliationSweepCounters,
  outcome: Awaited<ReturnType<typeof enqueueLayer1EvidenceRecomputeForUserBestEffort>>["outcome"],
): void {
  switch (outcome) {
    case "enqueued":
      m.enqueued += 1;
      break;
    case "skipped_already_fresh":
      m.skippedAlreadyFresh += 1;
      break;
    case "skipped_retry_exhausted":
      m.skippedRetryExhausted += 1;
      break;
    case "skipped_not_entitled":
      m.skippedNotEntitled += 1;
      break;
    case "skipped_user_not_found":
      m.skippedUserNotFound += 1;
      break;
    case "skipped_redis_disabled":
      m.skippedRedisDisabled += 1;
      break;
    case "enqueue_redis_failed":
      m.enqueueRedisFailed += 1;
      break;
    default:
      break;
  }
}

/**
 * Acquires a Postgres advisory lock, lists Advanced users needing Layer 1 work, and
 * enqueues each via {@link enqueueLayer1EvidenceRecomputeForUserBestEffort} with reason
 * `nightly_reconciliation`. Surfaces structured metrics for operators.
 */
export async function tryRunLayer1ReconciliationSweep(
  pool: Pool,
  input: Readonly<{
    env: ServerEnv;
    activeSignalVersion: string;
    failedRetryCooldownSec: number;
    usersPerTick: number;
    sweepStartedAt: Date;
  }>,
): Promise<Layer1ReconciliationSweepMetrics> {
  const empty = emptyCounters();
  const client = await pool.connect();
  let advisoryLockHeld = false;
  try {
    const { rows } = await client.query<{ ok: boolean }>(
      "select pg_try_advisory_lock($1::int, $2::int) as ok",
      [LAYER1_RECONCILE_LOCK_KEY1, LAYER1_RECONCILE_LOCK_KEY2],
    );
    if (!rows[0]?.ok) {
      return { ran: false, skipReason: "lock_not_acquired", ...empty };
    }
    advisoryLockHeld = true;

    const userIds = await listAdvancedUserIdsNeedingLayer1Reconciliation(client, {
      activeSignalVersion: input.activeSignalVersion,
      failedRetryCooldownSec: input.failedRetryCooldownSec,
      limit: input.usersPerTick,
    });
    const counters: Layer1ReconciliationSweepCounters = {
      ...empty,
      selectedUsers: userIds.length,
    };

    const sweepCorrelation = `layer1_reconcile:${input.sweepStartedAt.toISOString()}`;

    for (const userId of userIds) {
      const result = await enqueueLayer1EvidenceRecomputeForUserBestEffort({
        env: input.env,
        db: pool,
        userId,
        reason: "nightly_reconciliation",
        now: input.sweepStartedAt,
        correlationId: sweepCorrelation,
      });
      bump(counters, result.outcome);
    }

    return { ran: true, ...counters };
  } finally {
    if (advisoryLockHeld) {
      try {
        await client.query("select pg_advisory_unlock($1::int, $2::int)", [
          LAYER1_RECONCILE_LOCK_KEY1,
          LAYER1_RECONCILE_LOCK_KEY2,
        ]);
      } catch {
        /* best-effort unlock */
      }
    }
    client.release();
  }
}
