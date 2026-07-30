import { redactForLogLine } from "@vs/sensitive";
import { isRedisQueuesEnabled, type ServerEnv } from "@vs/env";

import { createSmokeTestQueue } from "./smoke-test-queue.js";

function formatUnknown(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return redactForLogLine(raw);
}

/**
 * Proves the BullMQ **producer** path (Queue + Redis) on this process: opens the
 * shared smoke queue, waits until BullMQ reports ready, then closes. Call once
 * at Next.js Node startup; throws on failure so the server does not boot half-wired.
 */
export async function ensureBullMqProducerStackReady(
  env: ServerEnv,
): Promise<void> {
  if (!isRedisQueuesEnabled(env)) {
    return;
  }
  const queue = createSmokeTestQueue(env);
  try {
    await queue.waitUntilReady();
  } catch (err) {
    throw new Error(
      `[env] BullMQ producer stack not ready (Redis or queue layer): ${formatUnknown(err)}. ` +
        "Ensure Redis is running and REDIS_URL matches your network.",
    );
  } finally {
    await queue.close();
  }
}
