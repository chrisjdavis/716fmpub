export type RateLimitDecision =
  | { ok: true; countInWindow: number }
  | { ok: false; retryAfterMs: number };

type Entry = {
  count: number;
  windowEndMs: number;
};

const store = new Map<string, Entry>();

const PRUNE_EVERY = 500;
let opsSincePrune = 0;

function pruneExpired(nowMs: number): void {
  for (const [k, e] of store) {
    if (e.windowEndMs <= nowMs) {
      store.delete(k);
    }
  }
}

/**
 * Fixed-window counter (per-process). Suitable for Edge middleware isolates; not distributed across instances.
 */
export function consumeFixedWindowToken(input: {
  key: string;
  max: number;
  windowMs: number;
  nowMs: number;
}): RateLimitDecision {
  opsSincePrune += 1;
  if (opsSincePrune >= PRUNE_EVERY) {
    opsSincePrune = 0;
    pruneExpired(input.nowMs);
  }

  const existing = store.get(input.key);
  if (!existing || input.nowMs >= existing.windowEndMs) {
    store.set(input.key, { count: 1, windowEndMs: input.nowMs + input.windowMs });
    return { ok: true, countInWindow: 1 };
  }

  if (existing.count < input.max) {
    existing.count += 1;
    return { ok: true, countInWindow: existing.count };
  }

  return {
    ok: false,
    retryAfterMs: Math.max(0, existing.windowEndMs - input.nowMs),
  };
}

/** @internal Vitest only */
export function resetFixedWindowRateLimitStoreForTests(): void {
  store.clear();
  opsSincePrune = 0;
}
