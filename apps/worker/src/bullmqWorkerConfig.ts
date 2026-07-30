import type { ServerEnv } from "@vs/env";
import { VS_QUEUE_NAMES, type VsQueueName } from "@vs/queue";

export type BullMqWorkerQueueConfig = Readonly<{
  queueName: VsQueueName;
  concurrency: number;
}>;

/**
 * Stable registration order for BullMQ workers (matches prior hard-coded list).
 */
export const BULLMQ_WORKER_QUEUE_REGISTRATION_ORDER: readonly VsQueueName[] = [
  VS_QUEUE_NAMES.SMOKE_TEST,
  VS_QUEUE_NAMES.IMPORTS,
  VS_QUEUE_NAMES.EXPORTS,
  VS_QUEUE_NAMES.ANALYTICS,
  VS_QUEUE_NAMES.SYNC,
  VS_QUEUE_NAMES.INCREMENTAL_SYNC,
] as const;

function bullMqWorkerConcurrencyForQueue(
  queueName: VsQueueName,
  env: ServerEnv,
): number {
  switch (queueName) {
    case VS_QUEUE_NAMES.SMOKE_TEST:
      return env.BULLMQ_WORKER_CONCURRENCY_SMOKE_TEST;
    case VS_QUEUE_NAMES.IMPORTS:
      return env.BULLMQ_WORKER_CONCURRENCY_IMPORTS;
    case VS_QUEUE_NAMES.EXPORTS:
      return env.BULLMQ_WORKER_CONCURRENCY_EXPORTS;
    case VS_QUEUE_NAMES.ANALYTICS:
      return env.BULLMQ_WORKER_CONCURRENCY_ANALYTICS;
    case VS_QUEUE_NAMES.SYNC:
      return env.BULLMQ_WORKER_CONCURRENCY_SYNC;
    case VS_QUEUE_NAMES.INCREMENTAL_SYNC:
      return env.BULLMQ_WORKER_CONCURRENCY_INCREMENTAL_SYNC;
    default: {
      const _exhaustive: never = queueName;
      return _exhaustive;
    }
  }
}

/**
 * One BullMQ `Worker` per canonical queue, with concurrency from `ServerEnv`
 * (`BULLMQ_WORKER_CONCURRENCY_*`) and safe schema defaults.
 */
export function bullMqQueueWorkerConfigFromEnv(
  env: ServerEnv,
): readonly BullMqWorkerQueueConfig[] {
  return BULLMQ_WORKER_QUEUE_REGISTRATION_ORDER.map((queueName) => ({
    queueName,
    concurrency: bullMqWorkerConcurrencyForQueue(queueName, env),
  }));
}

export function allVsQueueNamesRegistered(): boolean {
  const orderSet = new Set(BULLMQ_WORKER_QUEUE_REGISTRATION_ORDER);
  if (orderSet.size !== BULLMQ_WORKER_QUEUE_REGISTRATION_ORDER.length) {
    return false;
  }
  return Object.values(VS_QUEUE_NAMES).every((n) => orderSet.has(n));
}
