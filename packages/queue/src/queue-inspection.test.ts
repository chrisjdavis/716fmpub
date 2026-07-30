import { describe, expect, it } from "vitest";
import type { Job } from "bullmq";

import { VS_QUEUE_NAMES } from "./queue-names.js";
import {
  formatIsoOrNull,
  inspectionBucketCount,
  jobRowFromBullmqJob,
  jsonPreviewForInspection,
  parseQueueInspectJobSampleLimitFromEnv,
  QUEUE_INSPECTION_DATA_PREVIEW_MAX_CHARS,
  QUEUE_INSPECTION_FAILED_REASON_MAX_CHARS,
  QUEUE_INSPECTION_JOB_SAMPLE_LIMIT_HARD_CAP,
  shouldEmitJobForSampleBucket,
  sortedCanonicalVsQueueNames,
  truncateForInspection,
} from "./queue-inspection.js";

describe("sortedCanonicalVsQueueNames", () => {
  it("lists every canonical queue exactly once in stable sorted order", () => {
    const sorted = sortedCanonicalVsQueueNames();
    const values = Object.values(VS_QUEUE_NAMES);
    expect(sorted.length).toBe(values.length);
    expect(new Set(sorted).size).toBe(values.length);
    for (const v of values) {
      expect(sorted).toContain(v);
    }
    const copy = [...sorted].sort((a, b) => a.localeCompare(b));
    expect(sorted).toEqual(copy);
  });
});

describe("shouldEmitJobForSampleBucket", () => {
  it("only admits true waiting jobs into the waiting bucket", () => {
    expect(shouldEmitJobForSampleBucket("waiting", "waiting")).toBe(true);
    expect(shouldEmitJobForSampleBucket("waiting", "paused")).toBe(false);
    expect(shouldEmitJobForSampleBucket("waiting", "delayed")).toBe(false);
  });

  it("only admits paused jobs into the paused bucket", () => {
    expect(shouldEmitJobForSampleBucket("paused", "paused")).toBe(true);
    expect(shouldEmitJobForSampleBucket("paused", "waiting")).toBe(false);
  });

  it("matches other buckets by exact BullMQ state", () => {
    expect(shouldEmitJobForSampleBucket("delayed", "delayed")).toBe(true);
    expect(shouldEmitJobForSampleBucket("delayed", "waiting")).toBe(false);
    expect(shouldEmitJobForSampleBucket("active", "active")).toBe(true);
    expect(shouldEmitJobForSampleBucket("failed", "failed")).toBe(true);
    expect(shouldEmitJobForSampleBucket("completed", "completed")).toBe(true);
    expect(shouldEmitJobForSampleBucket("prioritized", "prioritized")).toBe(
      true,
    );
  });

  it("drops unknown BullMQ state", () => {
    expect(shouldEmitJobForSampleBucket("active", "unknown")).toBe(false);
  });
});

describe("inspectionBucketCount", () => {
  it("reads numeric counts with zero default", () => {
    expect(inspectionBucketCount({ waiting: 3, paused: 0 }, "waiting")).toBe(
      3,
    );
    expect(inspectionBucketCount({}, "paused")).toBe(0);
  });
});

describe("parseQueueInspectJobSampleLimitFromEnv", () => {
  it("returns undefined for empty or invalid input", () => {
    expect(parseQueueInspectJobSampleLimitFromEnv(undefined)).toBeUndefined();
    expect(parseQueueInspectJobSampleLimitFromEnv("")).toBeUndefined();
    expect(parseQueueInspectJobSampleLimitFromEnv("   ")).toBeUndefined();
    expect(parseQueueInspectJobSampleLimitFromEnv("x")).toBeUndefined();
  });

  it("parses integers and clamps to the hard cap", () => {
    expect(parseQueueInspectJobSampleLimitFromEnv(" 20 ")).toBe(20);
    expect(parseQueueInspectJobSampleLimitFromEnv("0")).toBe(0);
    expect(
      parseQueueInspectJobSampleLimitFromEnv(
        String(QUEUE_INSPECTION_JOB_SAMPLE_LIMIT_HARD_CAP + 999),
      ),
    ).toBe(QUEUE_INSPECTION_JOB_SAMPLE_LIMIT_HARD_CAP);
  });
});

describe("formatIsoOrNull", () => {
  it("returns null for missing or invalid timestamps", () => {
    expect(formatIsoOrNull(undefined)).toBeNull();
    expect(formatIsoOrNull(null)).toBeNull();
    expect(formatIsoOrNull(Number.NaN)).toBeNull();
  });

  it("formats epoch milliseconds as ISO UTC", () => {
    expect(formatIsoOrNull(0)).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("truncateForInspection", () => {
  it("does not truncate under the cap", () => {
    const r = truncateForInspection("abc", 10);
    expect(r).toEqual({ text: "abc", truncated: false });
  });

  it("suffixes ellipsis when truncated", () => {
    const r = truncateForInspection("abcdefghij", 5);
    expect(r.truncated).toBe(true);
    expect(r.text.endsWith("…")).toBe(true);
    expect(r.text.length).toBe(6);
  });
});

describe("jsonPreviewForInspection", () => {
  it("stringifies objects and truncates long payloads without claiming full fidelity", () => {
    const long = { x: "y".repeat(QUEUE_INSPECTION_DATA_PREVIEW_MAX_CHARS + 50) };
    const r = jsonPreviewForInspection(long, QUEUE_INSPECTION_DATA_PREVIEW_MAX_CHARS);
    expect(r.truncated).toBe(true);
    expect(r.preview.endsWith("…")).toBe(true);
  });

  it("emits a stable placeholder when inspection cannot serialize safely", () => {
    const o: Record<string, unknown> = {};
    Object.defineProperty(o, "x", {
      enumerable: true,
      configurable: true,
      get(): string {
        throw new Error("boom");
      },
    });
    const r = jsonPreviewForInspection(o, 50);
    expect(r.preview).toBe("[unserializable job data]");
    expect(r.truncated).toBe(false);
  });

  it("redacts secrets embedded in job data previews", () => {
    const r = jsonPreviewForInspection(
      { userId: "1", token: "sekret", url: "redis://:x@h/0" },
      200,
    );
    expect(r.preview).toContain("[REDACTED]");
    expect(r.preview).not.toContain("sekret");
    expect(r.preview).not.toContain("redis://:x@");
  });
});

describe("jobRowFromBullmqJob", () => {
  it("maps BullMQ fields into an explicit inspection row", () => {
    const job = {
      id: "42",
      name: "lastfm_rows",
      timestamp: 1_700_000_000_000,
      processedOn: 1_700_000_001_000,
      finishedOn: 1_700_000_002_000,
      failedReason: null,
      attemptsMade: 1,
      data: { importJobId: "job-1" },
    } as unknown as Job;

    const row = jobRowFromBullmqJob(
      VS_QUEUE_NAMES.IMPORTS,
      "waiting",
      "waiting",
      job,
    );
    expect(row.queueName).toBe("imports");
    expect(row.sampleFetchBucket).toBe("waiting");
    expect(row.bullmqState).toBe("waiting");
    expect(row.id).toBe("42");
    expect(row.name).toBe("lastfm_rows");
    expect(row.timestampIso).toBe("2023-11-14T22:13:20.000Z");
    expect(row.processedOnIso).toBe("2023-11-14T22:13:21.000Z");
    expect(row.finishedOnIso).toBe("2023-11-14T22:13:22.000Z");
    expect(row.failedReason).toBeNull();
    expect(row.failedReasonTruncated).toBe(false);
    expect(row.dataPreview).toContain("importJobId");
  });

  it("truncates long failure reasons without hiding that truncation happened", () => {
    const reason = "e".repeat(QUEUE_INSPECTION_FAILED_REASON_MAX_CHARS + 80);
    const job = {
      id: 7,
      name: "listen_catchup",
      timestamp: 1,
      processedOn: null,
      finishedOn: null,
      failedReason: reason,
      attemptsMade: 3,
      data: {},
    } as unknown as Job;

    const row = jobRowFromBullmqJob(VS_QUEUE_NAMES.SYNC, "failed", "failed", job);
    expect(row.failedReason).not.toBe(reason);
    expect(row.failedReasonTruncated).toBe(true);
    expect(row.id).toBe("7");
  });
});
