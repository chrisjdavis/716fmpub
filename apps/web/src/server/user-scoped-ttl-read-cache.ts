/**
 * In-process, user-scoped TTL cache for expensive read queries (per Node instance).
 * Keys never mix users: composite keys are `[namespace, userId, ...parts]`.
 */

/**
 * How a read was satisfied. `inflight_wait` is not a TTL store hit: it coalesced with another
 * in-flight factory for the same key (one miss, peers wait — operators must not treat it as cache warmth).
 */
export type ReadCacheServedFrom = "store_hit" | "inflight_wait" | "miss";

type Entry = { value: unknown; expiresAtMs: number };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

const metricsByNamespace = new Map<
  string,
  { storeHits: number; inflightWaits: number; misses: number }
>();

function metricsFor(namespace: string): {
  storeHits: number;
  inflightWaits: number;
  misses: number;
} {
  let m = metricsByNamespace.get(namespace);
  if (!m) {
    m = { storeHits: 0, inflightWaits: 0, misses: 0 };
    metricsByNamespace.set(namespace, m);
  }
  return m;
}

function compositeKey(namespace: string, userId: string, parts: readonly string[]): string {
  return [namespace, userId, ...parts].join("\x1f");
}

function parseUserFromCompositeKey(key: string): string | null {
  const i = key.indexOf("\x1f");
  if (i < 0) {
    return null;
  }
  const j = key.indexOf("\x1f", i + 1);
  if (j < 0) {
    return null;
  }
  return key.slice(i + 1, j);
}

/**
 * TTL bounds staleness when no invalidation runs (multi-instance deployments still rely on TTL).
 */
export const READ_CACHE_TTL_MS = {
  analytics_summary_canonical: 45_000,
  analytics_recent_listens: 30_000,
  analytics_archive_listens: 20_000,
  archive_shell_header_fallback: 45_000,
} as const;

export type ReadCacheTelemetryEntry = {
  namespace: string;
  served_from: ReadCacheServedFrom;
  /** Upper bound on staleness for TTL-backed rows (not remaining TTL on `store_hit`). */
  max_stale_seconds: number;
};

export async function userScopedTtlGetOrSet<T>(input: {
  namespace: string;
  ttlMs: number;
  userId: string;
  keyParts: readonly string[];
  factory: () => Promise<T>;
}): Promise<{ value: T; telemetry: ReadCacheTelemetryEntry }> {
  const { namespace, ttlMs, userId, keyParts, factory } = input;
  const key = compositeKey(namespace, userId, keyParts);
  const now = Date.now();
  const ent = store.get(key) as Entry | undefined;
  if (ent && ent.expiresAtMs > now) {
    metricsFor(namespace).storeHits++;
    return {
      value: ent.value as T,
      telemetry: {
        namespace,
        served_from: "store_hit",
        max_stale_seconds: Math.ceil(ttlMs / 1000),
      },
    };
  }

  const existingInflight = inflight.get(key) as Promise<T> | undefined;
  if (existingInflight) {
    const value = await existingInflight;
    metricsFor(namespace).inflightWaits++;
    return {
      value,
      telemetry: {
        namespace,
        served_from: "inflight_wait",
        max_stale_seconds: Math.ceil(ttlMs / 1000),
      },
    };
  }

  metricsFor(namespace).misses++;

  const p = (async () => {
    const value = await factory();
    store.set(key, { value, expiresAtMs: Date.now() + ttlMs });
    return value;
  })();

  inflight.set(key, p);
  try {
    const value = await p;
    return {
      value,
      telemetry: {
        namespace,
        served_from: "miss",
        max_stale_seconds: Math.ceil(ttlMs / 1000),
      },
    };
  } finally {
    inflight.delete(key);
  }
}

/** Operator-facing counters (per process); combine with logs or APM. */
export function getReadCacheMetricsSnapshot(): Record<
  string,
  { storeHits: number; inflightWaits: number; misses: number }
> {
  return Object.fromEntries(metricsByNamespace.entries());
}

/**
 * Drops every cached entry for `userId` across namespaces (e.g. after destructive mutations).
 */
export function invalidateUserScopedReadCaches(userId: string): void {
  for (const k of store.keys()) {
    if (parseUserFromCompositeKey(k) === userId) {
      store.delete(k);
    }
  }
}

/** Vitest isolation: clears entries and counters. */
export function resetUserScopedReadCacheForTests(): void {
  store.clear();
  inflight.clear();
  metricsByNamespace.clear();
}
