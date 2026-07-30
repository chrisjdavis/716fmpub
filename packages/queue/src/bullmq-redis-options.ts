import type { RedisOptions } from "ioredis";

/**
 * ioredis options required for BullMQ compatibility.
 * Always combine with `REDIS_URL` as the first `Redis` constructor argument.
 */
export function getBullMqIoredisOptions(): RedisOptions {
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };
}
