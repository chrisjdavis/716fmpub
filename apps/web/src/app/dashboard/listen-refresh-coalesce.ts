/**
 * Coalesces bursty listen invalidation signals (WebSocket `listens_updated`, fingerprint poll
 * deltas) into a single flush so `router.refresh()` is not invoked once per NOTIFY row.
 */

export type ListenRefreshFlushReason = "trailing_debounce" | "max_wait";

export type ListenRefreshCoalesceConfig = {
  /** Milliseconds after the last signal before flushing (trailing edge). */
  trailingDebounceMs: number;
  /**
   * Upper bound from the first signal in a burst until a flush is forced even if signals
   * keep arriving (deterministic worst-case staleness for operators).
   */
  maxWaitMs: number;
};

export type ListenRefreshFlushMeta = {
  /** Number of invalidation signals merged into this flush. */
  signalCount: number;
  flushReason: ListenRefreshFlushReason;
};

export function createListenRefreshCoalescer(
  config: ListenRefreshCoalesceConfig,
  onFlush: (meta: ListenRefreshFlushMeta) => void,
): {
  request: () => void;
  dispose: () => void;
} {
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  let signalCount = 0;
  let maxWaitArmed = false;

  function clearTrailing() {
    if (trailingTimer !== null) {
      clearTimeout(trailingTimer);
      trailingTimer = null;
    }
  }

  function clearMaxWait() {
    if (maxWaitTimer !== null) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  }

  function flush(reason: ListenRefreshFlushReason) {
    clearTrailing();
    clearMaxWait();
    maxWaitArmed = false;
    const n = signalCount;
    signalCount = 0;
    if (n > 0) {
      onFlush({ signalCount: n, flushReason: reason });
    }
  }

  function armMaxWaitIfNeeded() {
    if (maxWaitArmed) {
      return;
    }
    maxWaitArmed = true;
    maxWaitTimer = setTimeout(() => {
      maxWaitTimer = null;
      flush("max_wait");
    }, config.maxWaitMs);
  }

  function scheduleTrailing() {
    clearTrailing();
    trailingTimer = setTimeout(() => {
      trailingTimer = null;
      if (signalCount > 0) {
        flush("trailing_debounce");
      }
    }, config.trailingDebounceMs);
  }

  return {
    request() {
      signalCount += 1;
      armMaxWaitIfNeeded();
      scheduleTrailing();
    },
    dispose() {
      clearTrailing();
      clearMaxWait();
      signalCount = 0;
      maxWaitArmed = false;
    },
  };
}
