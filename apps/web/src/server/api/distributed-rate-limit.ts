import type { Redis } from "ioredis";
import { createBullMqRedisConnection } from "@vs/queue";
import { isRedisQueuesEnabled, type ServerEnv } from "@vs/env";
import { summarizeThrowableForLog } from "@vs/sensitive";
import type { RateLimitDecision } from "@/server/api/fixed-window-rate-limit";

let sharedRedis: Redis | null = null;
let sharedRedisEnvKey: string | null = null;

function getSharedRedis(env: ServerEnv): Redis | null {
  if (!isRedisQueuesEnabled(env) || !env.REDIS_URL) {
    return null;
  }
  const key = env.REDIS_URL;
  if (sharedRedis && sharedRedisEnvKey === key) {
    return sharedRedis;
  }
  if (sharedRedis) {
    sharedRedis.disconnect();
    sharedRedis = null;
    sharedRedisEnvKey = null;
  }
  try {
    sharedRedis = createBullMqRedisConnection(env);
    sharedRedisEnvKey = key;
    return sharedRedis;
  } catch (err) {
    console.warn(
      "[distributed-rate-limit] failed to open Redis:",
      summarizeThrowableForLog(err),
    );
    return null;
  }
}

/**
 * Fixed-window counter shared across web replicas via Redis.
 * When Redis is unavailable, returns `{ ok: true }` (fail-open) so Edge in-memory limits remain the floor.
 */
export async function consumeDistributedFixedWindowToken(input: {
  env: ServerEnv;
  key: string;
  max: number;
  windowMs: number;
  nowMs?: number;
}): Promise<RateLimitDecision> {
  const redis = getSharedRedis(input.env);
  if (!redis) {
    return { ok: true, countInWindow: 0 };
  }

  const windowMs = Math.max(1, input.windowMs);
  const nowMs = input.nowMs ?? Date.now();
  const windowId = Math.floor(nowMs / windowMs);
  const redisKey = `vs:rl:${input.key}:${windowId}`;
  const ttlSec = Math.max(1, Math.ceil(windowMs / 1000) + 1);

  try {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, ttlSec);
    }
    if (count > input.max) {
      const retryAfterMs = (windowId + 1) * windowMs - nowMs;
      return { ok: false, retryAfterMs: Math.max(1, retryAfterMs) };
    }
    return { ok: true, countInWindow: count };
  } catch (err) {
    console.warn(
      "[distributed-rate-limit] Redis INCR failed; failing open:",
      summarizeThrowableForLog(err),
    );
    return { ok: true, countInWindow: 0 };
  }
}
