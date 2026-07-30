import type { ServerEnv } from "@vs/env";
import { logQueueActivity, summarizeFailure } from "@vs/queue";

export function resolveWebReadCacheInvalidationOrigin(env: ServerEnv): string | undefined {
  const raw = env.VS_WEB_INTERNAL_ORIGIN ?? env.publicAppOrigin;
  if (!raw?.trim()) {
    return undefined;
  }
  return raw.trim().replace(/\/+$/, "");
}

/**
 * Best-effort HTTP call into the Next.js app so its in-process read cache drops stale rows after
 * worker-side mutations. No-ops when origin or internal secret is unset (multi-process coherence
 * then relies on TTL and client refresh contracts).
 */
export async function notifyWebAppListeningHistoryReadCacheInvalidationBestEffort(
  env: ServerEnv,
  userId: string,
): Promise<void> {
  const origin = resolveWebReadCacheInvalidationOrigin(env);
  const secret = env.VS_INTERNAL_API_SECRET;
  if (!origin || !secret || secret.length === 0) {
    return;
  }

  const url = `${origin}/api/internal/cache/invalidate-user-read-cache`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ user_id: userId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      logQueueActivity({
        level: "warn",
        event: "web_read_cache_invalidation_failed",
        queue: "web_read_cache_invalidation",
        userId,
        detail: {
          http_status: res.status,
          reason: "http_non_2xx",
        },
      });
    }
  } catch (err) {
    logQueueActivity({
      level: "warn",
      event: "web_read_cache_invalidation_failed",
      queue: "web_read_cache_invalidation",
      userId,
      detail: { reason: "fetch_error" },
      failure: summarizeFailure(err),
    });
  }
}
