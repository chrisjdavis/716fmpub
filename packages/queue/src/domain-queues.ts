import { Queue } from "bullmq";
import type { ServerEnv } from "@vs/env";

import { VS_QUEUE_NAMES } from "./queue-names.js";
import { createBullMqRedisConnection } from "./redis-connection.js";

/** Producer handle for the `imports` queue (close when done to avoid open handles). */
export function createImportsQueue(env: ServerEnv): Queue {
  return new Queue(VS_QUEUE_NAMES.IMPORTS, {
    connection: createBullMqRedisConnection(env),
  });
}

/** Producer handle for the `exports` queue. */
export function createExportsQueue(env: ServerEnv): Queue {
  return new Queue(VS_QUEUE_NAMES.EXPORTS, {
    connection: createBullMqRedisConnection(env),
  });
}

/** Producer handle for the `analytics` queue. */
export function createAnalyticsQueue(env: ServerEnv): Queue {
  return new Queue(VS_QUEUE_NAMES.ANALYTICS, {
    connection: createBullMqRedisConnection(env),
  });
}

/** Producer handle for the `sync` queue. */
export function createSyncQueue(env: ServerEnv): Queue {
  return new Queue(VS_QUEUE_NAMES.SYNC, {
    connection: createBullMqRedisConnection(env),
  });
}

/** Producer handle for the `incremental_sync` queue (`system_sync` import rows). */
export function createIncrementalSyncQueue(env: ServerEnv): Queue {
  return new Queue(VS_QUEUE_NAMES.INCREMENTAL_SYNC, {
    connection: createBullMqRedisConnection(env),
  });
}
