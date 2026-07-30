import { Queue } from "bullmq";
import type { ServerEnv } from "@vs/env";

import { VS_QUEUE_NAMES } from "./queue-names.js";
import { createBullMqRedisConnection } from "./redis-connection.js";

/** Producer handle for the smoke-test queue (close when done to avoid open handles). */
export function createSmokeTestQueue(env: ServerEnv): Queue {
  return new Queue(VS_QUEUE_NAMES.SMOKE_TEST, {
    connection: createBullMqRedisConnection(env),
  });
}
