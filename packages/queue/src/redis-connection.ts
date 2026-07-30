import { redactForLogLine } from "@vs/sensitive";
import { isRedisQueuesEnabled, type ServerEnv } from "@vs/env";
import { Redis } from "ioredis";

import { getBullMqIoredisOptions } from "./bullmq-redis-options.js";

/**
 * Central Redis client factory for BullMQ.
 * BullMQ requires `maxRetriesPerRequest: null` on ioredis.
 */
export function createBullMqRedisConnection(env: ServerEnv): Redis {
  if (!isRedisQueuesEnabled(env)) {
    throw new Error(
      "BullMQ Redis is disabled (FEATURE_FLAGS skipRedisQueues). This process should not open a Redis connection.",
    );
  }
  if (env.REDIS_URL === undefined || env.REDIS_URL.length === 0) {
    throw new Error("REDIS_URL is not set while Redis queues are enabled.");
  }
  return new Redis(env.REDIS_URL, getBullMqIoredisOptions());
}

/**
 * Probes Redis with PING using the same connection policy as BullMQ.
 */
export async function verifyRedisConnectivity(
  env: ServerEnv,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isRedisQueuesEnabled(env)) {
    return {
      ok: false,
      reason:
        'Redis queues are disabled (FEATURE_FLAGS={"skipRedisQueues":true}).',
    };
  }
  const redis = createBullMqRedisConnection(env);
  try {
    const reply = await redis.ping();
    if (reply !== "PONG") {
      return {
        ok: false,
        reason: `Redis PING returned unexpected reply: ${String(reply)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: redactForLogLine(message) };
  } finally {
    await redis.quit().catch(() => {
      redis.disconnect();
    });
  }
}
