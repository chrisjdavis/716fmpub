import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import { describe, expect, it, vi } from "vitest";

const { bestEffortMock } = vi.hoisted(() => ({
  bestEffortMock: vi.fn().mockResolvedValue({
    outcome: "enqueued",
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    reason: "listen_ingested",
  }),
}));

vi.mock("@vs/db", () => ({
  enqueueLayer1EvidenceRecomputeForUserBestEffort: bestEffortMock,
}));

import { enqueueLayer1AfterMeaningfulListenIngestion } from "./enqueueLayer1AfterMeaningfulListenIngestion.js";

describe("enqueueLayer1AfterMeaningfulListenIngestion", () => {
  it("no-ops when no canonical listens were produced", async () => {
    bestEffortMock.mockClear();
    const pool = {} as unknown as Pool;
    const env = {} as unknown as ServerEnv;
    const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await enqueueLayer1AfterMeaningfulListenIngestion(pool, env, userId, {
      canonicalizedNewListenRows: 0,
    });
    expect(bestEffortMock).not.toHaveBeenCalled();
  });

  it("delegates to enqueueLayer1EvidenceRecomputeForUserBestEffort with listen_ingested", async () => {
    bestEffortMock.mockClear();
    const pool = {} as unknown as Pool;
    const env = {} as unknown as ServerEnv;
    const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await enqueueLayer1AfterMeaningfulListenIngestion(pool, env, userId, {
      canonicalizedNewListenRows: 3,
    });
    expect(bestEffortMock).toHaveBeenCalledOnce();
    expect(bestEffortMock).toHaveBeenCalledWith({
      env,
      db: pool,
      userId,
      reason: "listen_ingested",
    });
  });
});
