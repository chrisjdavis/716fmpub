import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import { describe, expect, it, vi } from "vitest";

const { bestEffortMock } = vi.hoisted(() => ({
  bestEffortMock: vi.fn().mockResolvedValue({
    outcome: "enqueued",
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    reason: "import_completed",
  }),
}));

vi.mock("@vs/db", () => ({
  enqueueLayer1EvidenceRecomputeForUserBestEffort: bestEffortMock,
}));

import { enqueueLayer1AfterLastfmImportCompletion } from "./enqueueLayer1AfterLastfmImportCompletion.js";

describe("enqueueLayer1AfterLastfmImportCompletion", () => {
  it("delegates to enqueueLayer1EvidenceRecomputeForUserBestEffort with import_completed", async () => {
    bestEffortMock.mockClear();
    const pool = {} as unknown as Pool;
    const env = {} as unknown as ServerEnv;
    const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await enqueueLayer1AfterLastfmImportCompletion(pool, env, userId);
    expect(bestEffortMock).toHaveBeenCalledOnce();
    expect(bestEffortMock).toHaveBeenCalledWith({
      env,
      db: pool,
      userId,
      reason: "import_completed",
    });
  });
});
