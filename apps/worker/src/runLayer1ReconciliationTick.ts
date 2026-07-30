import { LAYER1_ACTIVE_SIGNAL_VERSION } from "@vs/domain";
import { tryRunLayer1ReconciliationSweep } from "@vs/db";
import type { Pool } from "pg";
import { isRedisQueuesEnabled, type ServerEnv } from "@vs/env";

let lastLayer1ReconcileSweepMs = 0;

/**
 * Periodic Advanced-only Layer 1 reconciliation (VS-83). Enqueues `nightly_reconciliation`
 * jobs through the centralized enqueue path when entitlement and freshness checks say work
 * is needed. Cadence is bounded by `LAYER1_RECONCILE_TICK_MIN_INTERVAL_SEC`.
 */
export async function runLayer1ReconciliationTick(
  pool: Pool,
  env: ServerEnv,
): Promise<void> {
  if (!isRedisQueuesEnabled(env)) {
    return;
  }
  const nowMs = Date.now();
  const intervalMs = env.LAYER1_RECONCILE_TICK_MIN_INTERVAL_SEC * 1000;
  if (nowMs - lastLayer1ReconcileSweepMs < intervalMs) {
    return;
  }

  const metrics = await tryRunLayer1ReconciliationSweep(pool, {
    env,
    activeSignalVersion: LAYER1_ACTIVE_SIGNAL_VERSION,
    failedRetryCooldownSec: env.LAYER1_RECONCILE_FAILED_RETRY_COOLDOWN_SEC,
    usersPerTick: env.LAYER1_RECONCILE_USERS_PER_TICK,
    sweepStartedAt: new Date(nowMs),
  });

  if (metrics.ran) {
    lastLayer1ReconcileSweepMs = nowMs;
    console.log(
      JSON.stringify({
        event: "layer1_reconciliation_sweep",
        ...metrics,
      }),
    );
  }
}
