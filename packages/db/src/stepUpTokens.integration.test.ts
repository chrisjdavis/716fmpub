import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { purgeUserListenData } from "./purgeUserListenData.js";
import {
  issueStepUpToken,
  STEP_UP_PURPOSE_PURGE_LISTEN_DATA,
  STEP_UP_TOKEN_TTL_MS,
  withConsumedStepUpToken,
} from "./stepUpTokens.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe.sequential("stepUpTokens (PGlite)", () => {
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
      `insert into users (id, email, password_hash)
       values ($1::uuid, 'step-up@example.test', 'x')`,
      [USER_ID],
    );
  });

  it("consumes a valid token once and runs the callback result", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken } = await issueStepUpToken(pool, USER_ID, STEP_UP_PURPOSE_PURGE_LISTEN_DATA);
    const step = await withConsumedStepUpToken(
      pool,
      { userId: USER_ID, purpose: STEP_UP_PURPOSE_PURGE_LISTEN_DATA, rawToken },
      async () => ({ n: 1 }),
    );
    expect(step.ok).toBe(true);
    if (step.ok) {
      expect(step.value).toEqual({ n: 1 });
    }
    const again = await withConsumedStepUpToken(
      pool,
      { userId: USER_ID, purpose: STEP_UP_PURPOSE_PURGE_LISTEN_DATA, rawToken },
      async () => ({ n: 2 }),
    );
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.reason).toBe("replayed");
    }
  });

  it("rejects an expired token without consuming", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken } = await issueStepUpToken(pool, USER_ID, STEP_UP_PURPOSE_PURGE_LISTEN_DATA);
    const past = Date.now() + STEP_UP_TOKEN_TTL_MS + 60_000;
    const step = await withConsumedStepUpToken(
      pool,
      {
        userId: USER_ID,
        purpose: STEP_UP_PURPOSE_PURGE_LISTEN_DATA,
        rawToken,
        nowMs: past,
      },
      async () => ({ n: 1 }),
    );
    expect(step.ok).toBe(false);
    if (!step.ok) {
      expect(step.reason).toBe("expired");
    }
    const retry = await withConsumedStepUpToken(
      pool,
      { userId: USER_ID, purpose: STEP_UP_PURPOSE_PURGE_LISTEN_DATA, rawToken },
      async () => ({ n: 2 }),
    );
    expect(retry.ok).toBe(true);
  });

  it("rejects a missing / wrong token", async () => {
    const pool = pgliteAsPool(pglite);
    const step = await withConsumedStepUpToken(
      pool,
      {
        userId: USER_ID,
        purpose: STEP_UP_PURPOSE_PURGE_LISTEN_DATA,
        rawToken: "not-a-real-token",
      },
      async () => true,
    );
    expect(step.ok).toBe(false);
    if (!step.ok) {
      expect(step.reason).toBe("invalid_token");
    }
  });

  it("rolls back consumption when the guarded callback throws", async () => {
    const pool = pgliteAsPool(pglite);
    await pglite.query(
      `insert into import_jobs (user_id, label, stage, lastfm_username)
       values ($1::uuid, 'j', 'completed', 'u')`,
      [USER_ID],
    );
    const { rawToken } = await issueStepUpToken(pool, USER_ID, STEP_UP_PURPOSE_PURGE_LISTEN_DATA);
    await expect(
      withConsumedStepUpToken(
        pool,
        { userId: USER_ID, purpose: STEP_UP_PURPOSE_PURGE_LISTEN_DATA, rawToken },
        async (client) => {
          await purgeUserListenData(client, USER_ID);
          throw new Error("simulated failure after purge");
        },
      ),
    ).rejects.toThrow("simulated failure after purge");

    const retry = await withConsumedStepUpToken(
      pool,
      { userId: USER_ID, purpose: STEP_UP_PURPOSE_PURGE_LISTEN_DATA, rawToken },
      async () => "ok",
    );
    expect(retry.ok).toBe(true);
  });
});
