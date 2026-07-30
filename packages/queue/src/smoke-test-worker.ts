import type { Job } from "bullmq";
import { Worker } from "bullmq";
import type { ServerEnv } from "@vs/env";

import { VS_QUEUE_NAMES } from "./queue-names.js";
import { createBullMqRedisConnection } from "./redis-connection.js";

export function createSmokeTestWorker(
  env: ServerEnv,
  processor: (job: Job<{ at: string }>) => Promise<void>,
): Worker {
  return new Worker(VS_QUEUE_NAMES.SMOKE_TEST, processor, {
    connection: createBullMqRedisConnection(env),
  });
}
