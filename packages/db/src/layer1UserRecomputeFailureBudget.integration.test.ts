import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import {
  finalizeLayer1UserRecomputeFailed,
  finalizeLayer1UserRecomputeFresh,
  getLayer1UserRecomputeStateRow,
} from "./layer1UserRecomputeState.js";

const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe.sequential("Layer1 user recompute failure budget (PGlite)", () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
    await applyMigrationsToPglite(pglite);
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(async () => {
    await pglite.exec("TRUNCATE TABLE users CASCADE");
    await pglite.query(
      `insert into users (id, email, password_hash, product_plan) values ($1::uuid, 'l1fail@example.test', 'x', 'advanced')`,
      [USER],
    );
    await pglite.query(
      `insert into layer1_user_recompute_state (
         user_id, status, signal_version, input_watermark,
         last_enqueued_at, last_started_at, last_succeeded_at,
         last_failed_at, failure_code, failure_message, consecutive_failure_count
       ) values ($1::uuid, 'queued', 'v-test', null, now(), now(), null, null, null, null, 0)`,
      [USER],
    );
  });

  it("marks failed_exhausted after max consecutive finalizeLayer1UserRecomputeFailed calls", async () => {
    const pool = pgliteAsPool(pglite);
    const max = 3;
    for (let i = 0; i < max - 1; i += 1) {
      await finalizeLayer1UserRecomputeFailed(pool, {
        userId: USER,
        failureCode: "unit_test_fail",
        failureMessage: `round ${i}`,
        maxConsecutiveFailures: max,
      });
      const mid = await getLayer1UserRecomputeStateRow(pool, USER);
      expect(mid?.status).toBe("failed");
      expect(mid?.consecutiveFailureCount).toBe(i + 1);
    }
    await finalizeLayer1UserRecomputeFailed(pool, {
      userId: USER,
      failureCode: "unit_test_fail",
      failureMessage: "final",
      maxConsecutiveFailures: max,
    });
    const row = await getLayer1UserRecomputeStateRow(pool, USER);
    expect(row?.status).toBe("failed_exhausted");
    expect(row?.consecutiveFailureCount).toBe(max);
    expect(row?.failureCode).toBe("unit_test_fail");
  });

  it("clears exhaustion counters on finalizeLayer1UserRecomputeFresh", async () => {
    const pool = pgliteAsPool(pglite);
    await finalizeLayer1UserRecomputeFailed(pool, {
      userId: USER,
      failureCode: "unit_test_fail",
      failureMessage: "x",
      maxConsecutiveFailures: 100,
    });
    await finalizeLayer1UserRecomputeFresh(pool, {
      userId: USER,
      inputWatermark: new Date("2026-01-02T00:00:00.000Z"),
    });
    const row = await getLayer1UserRecomputeStateRow(pool, USER);
    expect(row?.status).toBe("fresh");
    expect(row?.consecutiveFailureCount).toBe(0);
    expect(row?.failureCode).toBeNull();
  });
});
