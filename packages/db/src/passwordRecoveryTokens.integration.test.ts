import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  inspectPasswordRecoveryToken,
  issuePasswordRecoveryToken,
  PASSWORD_RECOVERY_TOKEN_TTL_MS,
  withConsumedPasswordRecoveryToken,
} from "./passwordRecoveryTokens.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";

const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe.sequential("passwordRecoveryTokens (PGlite)", () => {
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
       values ($1::uuid, 'recovery@example.test', 'legacy-hash-placeholder')`,
      [USER_ID],
    );
  });

  it("consumes a valid token once and runs the callback", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken } = await issuePasswordRecoveryToken(pool, USER_ID);
    const step = await withConsumedPasswordRecoveryToken(
      pool,
      { rawToken },
      async (client, { userId }) => {
        await client.query(
          `update users set password_hash = $2, updated_at = now() where id = $1::uuid`,
          [userId, "post-recovery-hash"],
        );
        return { n: 1 };
      },
    );
    expect(step.ok).toBe(true);
    if (step.ok) {
      expect(step.value).toEqual({ n: 1 });
    }
    const again = await withConsumedPasswordRecoveryToken(
      pool,
      { rawToken },
      async () => ({ n: 2 }),
    );
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.reason).toBe("replayed");
    }
  });

  it("rejects an expired token without consuming", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken } = await issuePasswordRecoveryToken(pool, USER_ID);
    const past = Date.now() + PASSWORD_RECOVERY_TOKEN_TTL_MS + 60_000;
    const step = await withConsumedPasswordRecoveryToken(
      pool,
      { rawToken, nowMs: past },
      async () => ({ n: 1 }),
    );
    expect(step.ok).toBe(false);
    if (!step.ok) {
      expect(step.reason).toBe("expired");
    }
    const retry = await withConsumedPasswordRecoveryToken(
      pool,
      { rawToken },
      async () => ({ n: 2 }),
    );
    expect(retry.ok).toBe(true);
  });

  it("rejects an invalid token", async () => {
    const pool = pgliteAsPool(pglite);
    const step = await withConsumedPasswordRecoveryToken(
      pool,
      { rawToken: "not-a-real-token-value-at-all-please" },
      async () => true,
    );
    expect(step.ok).toBe(false);
    if (!step.ok) {
      expect(step.reason).toBe("invalid_token");
    }
  });

  it("inspectPasswordRecoveryToken reports ok without consuming", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken } = await issuePasswordRecoveryToken(pool, USER_ID);
    const peek = await inspectPasswordRecoveryToken(pool, { rawToken });
    expect(peek.ok).toBe(true);
    const step = await withConsumedPasswordRecoveryToken(
      pool,
      { rawToken },
      async (client, { userId }) => {
        await client.query(
          `update users set password_hash = $2, updated_at = now() where id = $1::uuid`,
          [userId, "post-inspect-hash"],
        );
        return "done";
      },
    );
    expect(step.ok).toBe(true);
  });

  it("inspectPasswordRecoveryToken returns replayed after consumption", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken } = await issuePasswordRecoveryToken(pool, USER_ID);
    await withConsumedPasswordRecoveryToken(pool, { rawToken }, async () => "once");
    const peek = await inspectPasswordRecoveryToken(pool, { rawToken });
    expect(peek.ok).toBe(false);
    if (!peek.ok) {
      expect(peek.reason).toBe("replayed");
    }
  });

  it("inspectPasswordRecoveryToken returns expired when past TTL", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken } = await issuePasswordRecoveryToken(pool, USER_ID);
    const past = Date.now() + PASSWORD_RECOVERY_TOKEN_TTL_MS + 60_000;
    const peek = await inspectPasswordRecoveryToken(pool, { rawToken, nowMs: past });
    expect(peek.ok).toBe(false);
    if (!peek.ok) {
      expect(peek.reason).toBe("expired");
    }
    const retry = await withConsumedPasswordRecoveryToken(
      pool,
      { rawToken },
      async () => "still-ok",
    );
    expect(retry.ok).toBe(true);
  });

  it("inspectPasswordRecoveryToken returns invalid_token for unknown hash", async () => {
    const pool = pgliteAsPool(pglite);
    const peek = await inspectPasswordRecoveryToken(pool, {
      rawToken: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    });
    expect(peek.ok).toBe(false);
    if (!peek.ok) {
      expect(peek.reason).toBe("invalid_token");
    }
  });

  it("rejects consume when account_status is not active without consuming the token", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken } = await issuePasswordRecoveryToken(pool, USER_ID);
    await pglite.query(
      `update users set account_status = 'suspended', updated_at = now() where id = $1::uuid`,
      [USER_ID],
    );
    const blocked = await withConsumedPasswordRecoveryToken(
      pool,
      { rawToken },
      async () => ({ n: 1 }),
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toBe("account_not_active");
    }
    await pglite.query(
      `update users set account_status = 'active', updated_at = now() where id = $1::uuid`,
      [USER_ID],
    );
    const retry = await withConsumedPasswordRecoveryToken(
      pool,
      { rawToken },
      async () => ({ n: 2 }),
    );
    expect(retry.ok).toBe(true);
  });

  it("rolls back consumption when the guarded callback throws", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken } = await issuePasswordRecoveryToken(pool, USER_ID);
    await expect(
      withConsumedPasswordRecoveryToken(pool, { rawToken }, async () => {
        throw new Error("simulated failure before commit");
      }),
    ).rejects.toThrow("simulated failure before commit");

    const retry = await withConsumedPasswordRecoveryToken(
      pool,
      { rawToken },
      async () => "ok",
    );
    expect(retry.ok).toBe(true);
  });
});
