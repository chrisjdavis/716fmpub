import { UnrecoverableError } from "bullmq";
import { describe, expect, it } from "vitest";

import { throwIfListenCatchupNotEnqueued } from "./listenCatchupBullMq.js";

describe("throwIfListenCatchupNotEnqueued", () => {
  it("does nothing when enqueue succeeded", () => {
    expect(() =>
      throwIfListenCatchupNotEnqueued(
        { ok: true, importJobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        { bullmqJobId: "42", userId: "u", trigger: "manual" },
      ),
    ).not.toThrow();
  });

  it("throws UnrecoverableError with reason when DB declined enqueue", () => {
    expect(() =>
      throwIfListenCatchupNotEnqueued(
        { ok: false, reason: "no_canonical_listens" },
        { bullmqJobId: "job-1", userId: "user-1", trigger: "manual" },
      ),
    ).toThrow(UnrecoverableError);

    expect(() =>
      throwIfListenCatchupNotEnqueued(
        { ok: false, reason: "import_already_queued_or_running" },
        { bullmqJobId: "j", userId: "u", trigger: "scheduled" },
      ),
    ).toThrow(/import_already_queued_or_running/);
  });
});
