import { describe, expect, it } from "vitest";

import {
  defaultImportsJobOptions,
  IMPORTS_QUEUE_BACKOFF_INITIAL_MS,
  IMPORTS_QUEUE_MAX_ATTEMPTS,
} from "./imports-job-bullmq-options.js";

describe("imports-job-bullmq-options", () => {
  it("configures exponential backoff and bounded attempts", () => {
    const o = defaultImportsJobOptions();
    expect(o.attempts).toBe(IMPORTS_QUEUE_MAX_ATTEMPTS);
    expect(o.backoff).toEqual({
      type: "exponential",
      delay: IMPORTS_QUEUE_BACKOFF_INITIAL_MS,
    });
  });
});
