import type { ServerEnv } from "@vs/env";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { bestEffortMock } = vi.hoisted(() => ({
  bestEffortMock: vi.fn().mockResolvedValue({
    outcome: "enqueued",
    userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    reason: "advanced_upgrade",
  }),
}));

vi.mock("./layer1EvidenceRecomputeEnqueue.js", () => ({
  enqueueLayer1EvidenceRecomputeForUserBestEffort: bestEffortMock,
}));

import { enqueueLayer1EvidenceRecomputeForAdminCoreToAdvancedUpgradeBestEffort } from "./adminUserProductPlanLayer1Enqueue.js";

describe("enqueueLayer1EvidenceRecomputeForAdminCoreToAdvancedUpgradeBestEffort", () => {
  beforeEach(() => {
    bestEffortMock.mockClear();
  });

  it("delegates with advanced_upgrade, actor id, and admin-scoped correlation id", async () => {
    const env = {} as ServerEnv;
    const db = {} as Pool;
    const targetUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const actorUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await enqueueLayer1EvidenceRecomputeForAdminCoreToAdvancedUpgradeBestEffort({
      env,
      db,
      targetUserId,
      actorUserId,
    });
    expect(bestEffortMock).toHaveBeenCalledOnce();
    expect(bestEffortMock).toHaveBeenCalledWith({
      env,
      db,
      userId: targetUserId,
      reason: "advanced_upgrade",
      actorUserId,
      correlationId: `admin:product_plan:core_to_advanced:${targetUserId}`,
    });
  });
});
