import { afterEach, describe, expect, it, vi } from "vitest";
import type { Queue } from "bullmq";
import type { ServerEnv } from "@vs/env";
import * as env from "@vs/env";
import * as domainQueues from "./domain-queues.js";

import {
  enqueueDashboardBundleAnalyticsForUserBestEffort,
  enqueueDashboardBundleAnalyticsJob,
  enqueueLayer1EvidenceRecomputeExplicitUsers,
  layer1EvidenceRecomputeBullJobIdForUser,
} from "./analytics-dashboard-enqueue.js";
import { ANALYTICS_QUEUE_JOB_NAME } from "./job-contracts.js";

const USER = "11111111-1111-4111-8111-111111111111";

describe("enqueueDashboardBundleAnalyticsForUserBestEffort", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not open a queue producer when Redis queues are disabled", async () => {
    vi.spyOn(env, "isRedisQueuesEnabled").mockReturnValue(false);
    const createSpy = vi.spyOn(domainQueues, "createAnalyticsQueue");
    await enqueueDashboardBundleAnalyticsForUserBestEffort({} as ServerEnv, USER);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("enqueues then closes the producer when Redis is enabled", async () => {
    vi.spyOn(env, "isRedisQueuesEnabled").mockReturnValue(true);
    const close = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue({ id: "dash-1" });
    vi.spyOn(domainQueues, "createAnalyticsQueue").mockReturnValue({
      add,
      close,
    } as unknown as Queue);
    await enqueueDashboardBundleAnalyticsForUserBestEffort({} as ServerEnv, USER);
    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ userId: USER, mode: "incremental" }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("passes listenPeriodMetricsMode full to listen_period_metrics when requested", async () => {
    vi.spyOn(env, "isRedisQueuesEnabled").mockReturnValue(true);
    const close = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue({ id: "dash-1" });
    vi.spyOn(domainQueues, "createAnalyticsQueue").mockReturnValue({
      add,
      close,
    } as unknown as Queue);
    await enqueueDashboardBundleAnalyticsForUserBestEffort({} as ServerEnv, USER, {
      listenPeriodMetricsMode: "full",
    });
    expect(add.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ userId: USER, mode: "full" }),
    );
  });

  it("still enqueues listen_period_metrics when windowed_aggregate add fails", async () => {
    vi.spyOn(env, "isRedisQueuesEnabled").mockReturnValue(true);
    const close = vi.fn().mockResolvedValue(undefined);
    const add = vi
      .fn()
      .mockRejectedValueOnce(new Error("redis hiccup"))
      .mockResolvedValueOnce({ id: "period-1" });
    vi.spyOn(domainQueues, "createAnalyticsQueue").mockReturnValue({
      add,
      close,
    } as unknown as Queue);
    await enqueueDashboardBundleAnalyticsForUserBestEffort({} as ServerEnv, USER);
    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls[1]?.[0]).toBe(ANALYTICS_QUEUE_JOB_NAME.LISTEN_PERIOD_METRICS);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("enqueueDashboardBundleAnalyticsJob", () => {
  it("calls queue.add with windowed_aggregate payload and stable jobId", async () => {
    const add = vi.fn().mockResolvedValue({ id: "dash-1" });
    const queue = { add, name: "analytics" } as unknown as Queue;
    const now = new Date("2026-04-15T12:00:00.000Z");
    await enqueueDashboardBundleAnalyticsJob(queue, USER, now);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      ANALYTICS_QUEUE_JOB_NAME.WINDOWED_AGGREGATE,
      {
        windowStartIso: new Date(0).toISOString(),
        windowEndIso: now.toISOString(),
        userId: USER,
      },
      expect.objectContaining({
        jobId: `dashboard-bundle-${USER}`,
        removeOnComplete: true,
      }),
    );
  });

});

describe("enqueueLayer1EvidenceRecomputeExplicitUsers", () => {
  const uid = "22222222-2222-4222-8222-222222222222";

  it("sets stable jobId last for a single user (coalesces duplicate enqueue)", async () => {
    const add = vi.fn().mockResolvedValue({ id: "l1-1" });
    const queue = { add, name: "analytics" } as unknown as Queue;
    const now = new Date("2026-04-15T12:00:00.000Z");
    await enqueueLayer1EvidenceRecomputeExplicitUsers(queue, {
      userIds: [uid],
      enqueueReason: "listen_ingested",
      now,
      jobsOptions: { jobId: "should-not-win", delay: 42 },
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        jobId: layer1EvidenceRecomputeBullJobIdForUser(uid),
        removeOnComplete: true,
        delay: 42,
      }),
    );
  });

  it("does not inject a default jobId for multi-user explicit jobs", async () => {
    const add = vi.fn().mockResolvedValue({ id: "l1-2" });
    const queue = { add, name: "analytics" } as unknown as Queue;
    const u2 = "33333333-3333-4333-8333-333333333333";
    await enqueueLayer1EvidenceRecomputeExplicitUsers(queue, {
      userIds: [uid, u2],
      enqueueReason: "internal_backfill",
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]?.[2]).toBeUndefined();
  });
});
