import { UnrecoverableError, type Job } from "bullmq";
import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import { afterEach, describe, expect, it, vi } from "vitest";

const { recomputeMock, periodMetricsMock, layer1Mock, layer1EnqueueBestEffortMock } = vi.hoisted(
  () => ({
    recomputeMock: vi.fn().mockResolvedValue(undefined),
    periodMetricsMock: vi.fn().mockResolvedValue(undefined),
    layer1EnqueueBestEffortMock: vi.fn().mockResolvedValue({ outcome: "enqueued" }),
    layer1Mock: vi.fn().mockResolvedValue({
      layer1SignalRunId: "99999999-9999-4999-8999-999999999999",
      resolvedUserIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      userRollups: [
        {
          userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          userSkipped: null,
          success: 1,
          skip: 0,
          insufficiency: 0,
          failure: 0,
          userHardError: null,
        },
      ],
      totals: {
        success: 1,
        skip: 0,
        insufficiency: 0,
        failure: 0,
        usersWithHardError: 0,
      },
      runStatus: "succeeded" as const,
    }),
}));

vi.mock("@vs/db", () => ({
  recomputeDashboardAnalyticsBundle: recomputeMock,
  recomputeUserListenPeriodMetrics: periodMetricsMock,
  runLayer1EvidenceRecomputeJob: layer1Mock,
  enqueueLayer1EvidenceRecomputeForUserBestEffort: layer1EnqueueBestEffortMock,
}));

const notifyMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("./webReadCacheInvalidation.js", () => ({
  notifyWebAppListeningHistoryReadCacheInvalidationBestEffort: notifyMock,
}));

const onboardingNotifyMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("./webOnboardingImportReadyNotification.js", () => ({
  notifyWebAppOnboardingImportReadyBestEffort: onboardingNotifyMock,
}));

import { processAnalyticsJob } from "./analyticsQueueProcessor.js";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const testEnv = {
  LAYER1_RECOMPUTE_MAX_CONSECUTIVE_FAILURES: 11,
} as ServerEnv;

describe("processAnalyticsJob", () => {
  afterEach(() => {
    recomputeMock.mockClear();
    periodMetricsMock.mockClear();
    layer1Mock.mockClear();
    layer1EnqueueBestEffortMock.mockClear();
    notifyMock.mockClear();
    onboardingNotifyMock.mockClear();
  });

  it("parses job and calls recomputeDashboardAnalyticsBundle with window end as nowMs", async () => {
    const pool = {} as Pool;
    const endIso = "2026-04-15T10:00:00.000Z";
    const job = {
      id: "j1",
      name: "windowed_aggregate",
      data: {
        windowStartIso: "1970-01-01T00:00:00.000Z",
        windowEndIso: endIso,
        userId: USER,
      },
    } as Job;
    await processAnalyticsJob(job, pool, testEnv);
    expect(recomputeMock).toHaveBeenCalledWith(pool, {
      userId: USER,
      nowMs: Date.parse(endIso),
    });
    expect(layer1EnqueueBestEffortMock).toHaveBeenCalledWith({
      env: testEnv,
      db: pool,
      userId: USER,
      reason: "listen_ingested",
      now: new Date(Date.parse(endIso)),
    });
    expect(notifyMock).toHaveBeenCalledWith(testEnv, USER);
  });

  it("rejects jobs without userId", async () => {
    const pool = {} as Pool;
    const job = {
      id: "j2",
      name: "windowed_aggregate",
      data: {
        windowStartIso: "2026-04-01T00:00:00.000Z",
        windowEndIso: "2026-04-02T00:00:00.000Z",
      },
    } as Job;
    await expect(processAnalyticsJob(job, pool, testEnv)).rejects.toThrow(UnrecoverableError);
    expect(recomputeMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("rejects inverted windows", async () => {
    const pool = {} as Pool;
    const job = {
      id: "j3",
      name: "windowed_aggregate",
      data: {
        windowStartIso: "2026-04-10T00:00:00.000Z",
        windowEndIso: "2026-04-01T00:00:00.000Z",
        userId: USER,
      },
    } as Job;
    await expect(processAnalyticsJob(job, pool, testEnv)).rejects.toThrow(UnrecoverableError);
    expect(recomputeMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("runs listen_period_metrics recompute for user", async () => {
    const pool = {} as Pool;
    const job = {
      id: "j4",
      name: "listen_period_metrics",
      data: { userId: USER },
    } as Job;
    await processAnalyticsJob(job, pool, testEnv);
    expect(periodMetricsMock).toHaveBeenCalledWith(pool, USER, { mode: "incremental" });
    expect(recomputeMock).not.toHaveBeenCalled();
    expect(notifyMock).toHaveBeenCalledWith(testEnv, USER);
    expect(onboardingNotifyMock).toHaveBeenCalledWith(testEnv, USER);
  });

  it("runs layer1_evidence_recompute job", async () => {
    const pool = {} as Pool;
    const anchor = "2026-04-15T10:00:00.000Z";
    const job = {
      id: "j-layer1",
      name: "layer1_evidence_recompute",
      data: {
        nowMsAnchorIso: anchor,
        scope: { kind: "explicit_user_ids", userIds: [USER] },
        enqueueReason: "signal_version_changed",
      },
    } as Job;
    await processAnalyticsJob(job, pool, testEnv);
    expect(layer1Mock).toHaveBeenCalledWith(pool, {
      nowMs: Date.parse(anchor),
      scope: { kind: "explicit_user_ids", userIds: [USER] },
      triggerKind: "analytics_queue.layer1_evidence_recompute",
      enqueueReason: "signal_version_changed",
      correlationId: null,
      actorUserId: null,
      artistLimit: undefined,
      bullmqJobId: "j-layer1",
      maxConsecutiveFailures: 11,
    });
    expect(recomputeMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("throws UnrecoverableError when layer1 job reports failed run", async () => {
    layer1Mock.mockResolvedValueOnce({
      layer1SignalRunId: "88888888-8888-4888-8888-888888888888",
      resolvedUserIds: [USER],
      userRollups: [
        {
          userId: USER,
          userSkipped: null,
          success: 0,
          skip: 0,
          insufficiency: 0,
          failure: 1,
          userHardError: null,
        },
      ],
      totals: {
        success: 0,
        skip: 0,
        insufficiency: 0,
        failure: 1,
        usersWithHardError: 0,
      },
      runStatus: "failed" as const,
    });
    const pool = {} as Pool;
    const job = {
      id: "j-layer1-fail",
      name: "layer1_evidence_recompute",
      data: {
        nowMsAnchorIso: "2026-04-15T10:00:00.000Z",
        scope: { kind: "explicit_user_ids", userIds: [USER] },
        enqueueReason: "nightly_reconciliation",
      },
    } as Job;
    await expect(processAnalyticsJob(job, pool, testEnv)).rejects.toThrow(UnrecoverableError);
  });
});
