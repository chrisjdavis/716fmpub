import { parseServerEnv } from "@vs/env";
import { VS_QUEUE_NAMES } from "@vs/queue";
import { describe, expect, it } from "vitest";

import {
  allVsQueueNamesRegistered,
  BULLMQ_WORKER_QUEUE_REGISTRATION_ORDER,
  bullMqQueueWorkerConfigFromEnv,
} from "./bullmqWorkerConfig.js";

function testEnv(
  overrides: Record<string, string | undefined> = {},
): ReturnType<typeof parseServerEnv> {
  return parseServerEnv({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
    REDIS_URL: "redis://127.0.0.1:6379",
    ...overrides,
  });
}

describe("bullmqWorkerConfig", () => {
  it("registers every canonical VS queue name", () => {
    expect(allVsQueueNamesRegistered()).toBe(true);
    expect(new Set(BULLMQ_WORKER_QUEUE_REGISTRATION_ORDER)).toEqual(
      new Set(Object.values(VS_QUEUE_NAMES)),
    );
  });

  it("uses positive concurrency for each queue (schema defaults)", () => {
    const env = testEnv();
    for (const row of bullMqQueueWorkerConfigFromEnv(env)) {
      expect(row.concurrency).toBeGreaterThan(0);
    }
  });

  it("maps env overrides into worker config", () => {
    const env = testEnv({
      BULLMQ_WORKER_CONCURRENCY_IMPORTS: "5",
      BULLMQ_WORKER_CONCURRENCY_EXPORTS: "3",
    });
    const byName = Object.fromEntries(
      bullMqQueueWorkerConfigFromEnv(env).map((c) => [c.queueName, c.concurrency]),
    );
    expect(byName[VS_QUEUE_NAMES.IMPORTS]).toBe(5);
    expect(byName[VS_QUEUE_NAMES.EXPORTS]).toBe(3);
  });

  it("uses safe defaults when BullMQ concurrency vars are unset", () => {
    const env = testEnv();
    const byName = Object.fromEntries(
      bullMqQueueWorkerConfigFromEnv(env).map((c) => [c.queueName, c.concurrency]),
    );
    expect(byName[VS_QUEUE_NAMES.SMOKE_TEST]).toBe(1);
    expect(byName[VS_QUEUE_NAMES.IMPORTS]).toBe(2);
    expect(byName[VS_QUEUE_NAMES.EXPORTS]).toBe(1);
    expect(byName[VS_QUEUE_NAMES.ANALYTICS]).toBe(1);
    expect(byName[VS_QUEUE_NAMES.SYNC]).toBe(2);
    expect(byName[VS_QUEUE_NAMES.INCREMENTAL_SYNC]).toBe(2);
  });
});
