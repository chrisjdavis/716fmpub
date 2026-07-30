import { describe, expect, it } from "vitest";

import { getBullMqIoredisOptions } from "./bullmq-redis-options.js";

describe("getBullMqIoredisOptions", () => {
  it("returns BullMQ-required ioredis settings", () => {
    const opts = getBullMqIoredisOptions();
    expect(opts.maxRetriesPerRequest).toBeNull();
    expect(opts.enableReadyCheck).toBe(true);
  });
});
