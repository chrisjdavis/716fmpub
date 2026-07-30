/**
 * VS-83 — worker-driven Layer 1 reconciliation cadence (Advanced-only safety net).
 */

/** Default minimum seconds between reconciliation sweeps (nightly-style). */
export const LAYER1_RECONCILE_TICK_MIN_INTERVAL_SEC_DEFAULT = 86_400 as const;

/** Default cap on Advanced accounts examined per sweep (enqueue uses stable BullMQ job ids). */
export const LAYER1_RECONCILE_USERS_PER_TICK_DEFAULT = 200 as const;

/** Default seconds after `last_failed_at` before a failed Layer 1 row is eligible again. */
export const LAYER1_RECONCILE_FAILED_RETRY_COOLDOWN_SEC_DEFAULT = 3_600 as const;

/**
 * VS-84 — cap on consecutive persisted Layer 1 failures per user before lifecycle producers
 * stop re-enqueueing (operator / internal reasons can reset the budget).
 */
export const LAYER1_RECOMPUTE_MAX_CONSECUTIVE_FAILURES_DEFAULT = 8 as const;
