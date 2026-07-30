import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractSafeJobDataFields,
  logQueueActivity,
  summarizeFailure,
} from "./queue-structured-log.js";

describe("queue-structured-log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extractSafeJobDataFields copies only known identity keys", () => {
    expect(
      extractSafeJobDataFields({
        userId: "u1",
        importJobId: "i1",
        exportJobId: "e1",
        secretToken: "nope",
      }),
    ).toEqual({
      userId: "u1",
      importJobId: "i1",
      exportJobId: "e1",
    });
  });

  it("extractSafeJobDataFields ignores non-objects and arrays", () => {
    expect(extractSafeJobDataFields(null)).toEqual({});
    expect(extractSafeJobDataFields([1, 2])).toEqual({});
  });

  it("summarizeFailure truncates long messages", () => {
    const long = "x".repeat(1200);
    const s = summarizeFailure(new Error(long));
    expect(s.errorType).toBe("Error");
    expect(s.errorMessage.length).toBeLessThanOrEqual(850);
    expect(s.errorMessage).toContain("truncated");
  });

  it("logQueueActivity emits a single JSON line on stdout", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg: unknown) => {
      lines.push(String(msg));
    });
    logQueueActivity({
      level: "info",
      event: "job_started",
      queue: "imports",
      bullmqJobId: "42",
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      jobName: "lastfm_rows_import",
    });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(parsed.component).toBe("vs-queue");
    expect(parsed.vs).toEqual({ kind: "queue_activity", v: 1 });
    expect(parsed.event).toBe("job_started");
    expect(parsed.queue).toBe("imports");
    expect(parsed.bullmqJobId).toBe("42");
    expect(parsed.userId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("logQueueActivity routes errors to console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logQueueActivity({
      level: "error",
      event: "job_failed",
      queue: "exports",
      bullmqJobId: "7",
      failure: summarizeFailure(new Error("boom")),
    });
    expect(spy).toHaveBeenCalledOnce();
    const line = String(spy.mock.calls[0]?.[0]);
    expect(JSON.parse(line).failure.errorMessage).toBe("boom");
  });
});
