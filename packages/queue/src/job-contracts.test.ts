import { describe, expect, it, vi } from "vitest";
import type { Queue } from "bullmq";

import {
  ANALYTICS_QUEUE_JOB_NAME,
  EXPORTS_QUEUE_JOB_NAME,
  IMPORTS_QUEUE_JOB_NAME,
  INCREMENTAL_SYNC_QUEUE_JOB_NAME,
  SYNC_QUEUE_JOB_NAME,
  VsInvalidJobPayloadError,
  parseAnalyticsWorkerJob,
  parseExportsWorkerJob,
  parseImportsWorkerJob,
  parseIncrementalSyncWorkerJob,
  parseSyncWorkerJob,
  validateAnalyticsJobSpec,
  validateExportsJobSpec,
  validateImportsJobSpec,
  validateIncrementalSyncJobSpec,
  validateSyncJobSpec,
} from "./job-contracts.js";
import { defaultImportsJobOptions } from "./imports-job-bullmq-options.js";
import { defaultIncrementalSyncJobOptions } from "./incremental-sync-job-bullmq-options.js";
import {
  enqueueAnalyticsJob,
  enqueueExportsJob,
  enqueueImportsJob,
  enqueueIncrementalSyncJob,
  enqueueSyncJob,
} from "./enqueue-validated.js";

const USER = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const EXPORT = "33333333-3333-4333-8333-333333333333";

describe("job contracts", () => {
  describe("imports", () => {
    it("accepts a valid spec", () => {
      const out = validateImportsJobSpec({
        name: IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT,
        data: { importJobId: JOB, userId: USER },
      });
      expect(out.data.importJobId).toBe(JOB);
    });

    it("rejects bad UUIDs", () => {
      expect(() =>
        validateImportsJobSpec({
          name: IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT,
          data: { importJobId: "not-a-uuid", userId: USER },
        }),
      ).toThrow(VsInvalidJobPayloadError);
    });

    it("parseImportsWorkerJob rejects unknown job names", () => {
      expect(() =>
        parseImportsWorkerJob({
          name: "unknown",
          data: { importJobId: JOB, userId: USER },
        }),
      ).toThrow(VsInvalidJobPayloadError);
    });
  });

  describe("exports", () => {
    it("accepts a valid spec", () => {
      const out = validateExportsJobSpec({
        name: EXPORTS_QUEUE_JOB_NAME.USER_DATA_PACKAGE,
        data: { userId: USER, exportJobId: EXPORT },
      });
      expect(out.data.exportJobId).toBe(EXPORT);
    });
  });

  describe("analytics", () => {
    it("accepts ISO datetimes with offsets", () => {
      const out = validateAnalyticsJobSpec({
        name: ANALYTICS_QUEUE_JOB_NAME.WINDOWED_AGGREGATE,
        data: {
          windowStartIso: "2026-04-01T00:00:00.000Z",
          windowEndIso: "2026-04-02T00:00:00.000Z",
        },
      });
      if (out.name !== ANALYTICS_QUEUE_JOB_NAME.WINDOWED_AGGREGATE) {
        throw new Error("expected windowed_aggregate");
      }
      expect(out.data.userId).toBeUndefined();
    });

    it("allows optional userId", () => {
      const out = validateAnalyticsJobSpec({
        name: ANALYTICS_QUEUE_JOB_NAME.WINDOWED_AGGREGATE,
        data: {
          windowStartIso: "2026-04-01T00:00:00.000+00:00",
          windowEndIso: "2026-04-02T00:00:00.000+00:00",
          userId: USER,
        },
      });
      if (out.name !== ANALYTICS_QUEUE_JOB_NAME.WINDOWED_AGGREGATE) {
        throw new Error("expected windowed_aggregate");
      }
      expect(out.data.userId).toBe(USER);
    });

    it("rejects invalid datetimes", () => {
      expect(() =>
        validateAnalyticsJobSpec({
          name: ANALYTICS_QUEUE_JOB_NAME.WINDOWED_AGGREGATE,
          data: {
            windowStartIso: "not-a-date",
            windowEndIso: "2026-04-02T00:00:00.000Z",
          },
        }),
      ).toThrow(VsInvalidJobPayloadError);
    });

    it("accepts listen_period_metrics payload", () => {
      const out = validateAnalyticsJobSpec({
        name: ANALYTICS_QUEUE_JOB_NAME.LISTEN_PERIOD_METRICS,
        data: { userId: USER },
      });
      expect(out.name).toBe(ANALYTICS_QUEUE_JOB_NAME.LISTEN_PERIOD_METRICS);
      if (out.name !== ANALYTICS_QUEUE_JOB_NAME.LISTEN_PERIOD_METRICS) {
        throw new Error("expected listen_period_metrics");
      }
      expect(out.data.userId).toBe(USER);
      expect(out.data.mode).toBe("incremental");
    });

    it("accepts listen_period_metrics full mode", () => {
      const out = validateAnalyticsJobSpec({
        name: ANALYTICS_QUEUE_JOB_NAME.LISTEN_PERIOD_METRICS,
        data: { userId: USER, mode: "full" },
      });
      if (out.name !== ANALYTICS_QUEUE_JOB_NAME.LISTEN_PERIOD_METRICS) {
        throw new Error("expected listen_period_metrics");
      }
      expect(out.data.mode).toBe("full");
    });

    it("accepts layer1_evidence_recompute explicit users", () => {
      const out = validateAnalyticsJobSpec({
        name: ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE,
        data: {
          nowMsAnchorIso: "2026-04-01T12:00:00.000Z",
          scope: { kind: "explicit_user_ids", userIds: [USER] },
          enqueueReason: "listen_ingested",
        },
      });
      expect(out.name).toBe(ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE);
      if (out.name !== ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE) {
        throw new Error("expected layer1_evidence_recompute");
      }
      expect(out.data.scope.kind).toBe("explicit_user_ids");
      expect(out.data.enqueueReason).toBe("listen_ingested");
    });

    it("rejects layer1_evidence_recompute with unknown enqueueReason", () => {
      expect(() =>
        validateAnalyticsJobSpec({
          name: ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE,
          data: {
            nowMsAnchorIso: "2026-04-01T12:00:00.000Z",
            scope: { kind: "explicit_user_ids", userIds: [USER] },
            // @ts-expect-error intentional invalid enum for Zod
            enqueueReason: "legacy_analytics_summary_refresh",
          },
        }),
      ).toThrow(VsInvalidJobPayloadError);
    });

    it("accepts layer1_evidence_recompute cursor batch", () => {
      const out = validateAnalyticsJobSpec({
        name: ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE,
        data: {
          nowMsAnchorIso: "2026-04-01T12:00:00.000Z",
          scope: { kind: "user_cursor_batch", cursorAfterUserId: null, limit: 10 },
          enqueueReason: "internal_backfill",
        },
      });
      if (out.name !== ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE) {
        throw new Error("expected layer1_evidence_recompute");
      }
      expect(out.data.scope.kind).toBe("user_cursor_batch");
    });

    it("parseAnalyticsWorkerJob parses layer1_evidence_recompute", () => {
      const parsed = parseAnalyticsWorkerJob({
        name: "layer1_evidence_recompute",
        data: {
          nowMsAnchorIso: "2026-04-01T12:00:00.000Z",
          scope: { kind: "explicit_user_ids", userIds: [USER] },
          enqueueReason: "import_completed",
        },
      });
      expect(parsed.name).toBe(ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE);
      if (parsed.name !== ANALYTICS_QUEUE_JOB_NAME.LAYER1_EVIDENCE_RECOMPUTE) {
        throw new Error("expected layer1_evidence_recompute");
      }
      expect(parsed.data.enqueueReason).toBe("import_completed");
    });
  });

  describe("incremental_sync", () => {
    it("accepts a valid spec", () => {
      const out = validateIncrementalSyncJobSpec({
        name: INCREMENTAL_SYNC_QUEUE_JOB_NAME.SYSTEM_SYNC_RUN,
        data: { importJobId: JOB, userId: USER },
      });
      expect(out.data.importJobId).toBe(JOB);
    });

    it("parseIncrementalSyncWorkerJob rejects unknown job names", () => {
      expect(() =>
        parseIncrementalSyncWorkerJob({
          name: "unknown",
          data: { importJobId: JOB, userId: USER },
        }),
      ).toThrow(VsInvalidJobPayloadError);
    });
  });

  describe("sync", () => {
    it("requires explicit trigger", () => {
      expect(() =>
        validateSyncJobSpec({
          name: SYNC_QUEUE_JOB_NAME.LISTEN_CATCHUP,
          // @ts-expect-error intentional invalid enum for Zod
          data: { userId: USER, trigger: "nope" },
        }),
      ).toThrow(VsInvalidJobPayloadError);
    });

    it("parseSyncWorkerJob returns typed payload", () => {
      const parsed = parseSyncWorkerJob({
        name: SYNC_QUEUE_JOB_NAME.LISTEN_CATCHUP,
        data: { userId: USER, trigger: "manual" },
      });
      expect(parsed.data.trigger).toBe("manual");
    });
  });

  describe("cross-queue isolation", () => {
    it("parseExportsWorkerJob does not accept imports job names", () => {
      expect(() =>
        parseExportsWorkerJob({
          name: IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT,
          data: { userId: USER, exportJobId: EXPORT },
        }),
      ).toThrow(VsInvalidJobPayloadError);
    });

    it("parseIncrementalSyncWorkerJob does not accept imports job names", () => {
      expect(() =>
        parseIncrementalSyncWorkerJob({
          name: IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT,
          data: { importJobId: JOB, userId: USER },
        }),
      ).toThrow(VsInvalidJobPayloadError);
    });
  });
});

describe("enqueue-validated", () => {
  it("enqueueImportsJob calls queue.add only after validation", async () => {
    const add = vi.fn().mockResolvedValue({ id: "99" });
    const queue = { add, name: "imports" } as unknown as Queue;
    await enqueueImportsJob(queue, {
      name: IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT,
      data: { importJobId: JOB, userId: USER },
    });
    expect(add).toHaveBeenCalledWith(
      IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT,
      { importJobId: JOB, userId: USER },
      { ...defaultImportsJobOptions(), jobId: JOB },
    );
  });

  it("enqueueImportsJob merges caller job options over defaults", async () => {
    const add = vi.fn().mockResolvedValue({ id: "99" });
    const queue = { add, name: "imports" } as unknown as Queue;
    await enqueueImportsJob(
      queue,
      {
        name: IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT,
        data: { importJobId: JOB, userId: USER },
      },
      { attempts: 2 },
    );
    expect(add).toHaveBeenCalledWith(
      IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT,
      { importJobId: JOB, userId: USER },
      {
        ...defaultImportsJobOptions(),
        jobId: JOB,
        attempts: 2,
      },
    );
  });

  it("enqueueImportsJob does not call add when payload is invalid", async () => {
    const add = vi.fn();
    const queue = { add, name: "imports" } as unknown as Queue;
    await expect(
      enqueueImportsJob(queue, {
        name: IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT,
        data: { importJobId: "bad", userId: USER },
      }),
    ).rejects.toThrow(VsInvalidJobPayloadError);
    expect(add).not.toHaveBeenCalled();
  });

  it("enqueueExportsJob validates before add", async () => {
    const add = vi.fn().mockResolvedValue({ id: "exp-1" });
    const queue = { add, name: "exports" } as unknown as Queue;
    await enqueueExportsJob(queue, {
      name: EXPORTS_QUEUE_JOB_NAME.USER_DATA_PACKAGE,
      data: { userId: USER, exportJobId: EXPORT },
    });
    expect(add).toHaveBeenCalledOnce();
  });

  it("enqueueAnalyticsJob validates before add", async () => {
    const add = vi.fn().mockResolvedValue({ id: "an-1" });
    const queue = { add, name: "analytics" } as unknown as Queue;
    await enqueueAnalyticsJob(queue, {
      name: ANALYTICS_QUEUE_JOB_NAME.WINDOWED_AGGREGATE,
      data: {
        windowStartIso: "2026-04-01T00:00:00.000Z",
        windowEndIso: "2026-04-02T00:00:00.000Z",
      },
    });
    expect(add).toHaveBeenCalledOnce();
  });

  it("enqueueSyncJob validates before add", async () => {
    const add = vi.fn().mockResolvedValue({ id: "sy-1" });
    const queue = { add, name: "sync" } as unknown as Queue;
    await enqueueSyncJob(queue, {
      name: SYNC_QUEUE_JOB_NAME.LISTEN_CATCHUP,
      data: { userId: USER, trigger: "scheduled" },
    });
    expect(add).toHaveBeenCalledOnce();
  });

  it("enqueueIncrementalSyncJob validates, sets jobId, and merges default BullMQ options", async () => {
    const add = vi.fn().mockResolvedValue({ id: "99" });
    const queue = { add, name: "incremental_sync" } as unknown as Queue;
    await enqueueIncrementalSyncJob(queue, {
      name: INCREMENTAL_SYNC_QUEUE_JOB_NAME.SYSTEM_SYNC_RUN,
      data: { importJobId: JOB, userId: USER },
    });
    expect(add).toHaveBeenCalledWith(
      INCREMENTAL_SYNC_QUEUE_JOB_NAME.SYSTEM_SYNC_RUN,
      { importJobId: JOB, userId: USER },
      {
        ...defaultIncrementalSyncJobOptions(),
        jobId: JOB,
      },
    );
  });
});
