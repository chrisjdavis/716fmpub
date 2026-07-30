import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  EMAIL_VERIFICATION_TOKEN_TTL_MS,
  issueEmailVerificationToken,
  withConsumedEmailVerificationToken,
} from "./emailVerificationTokens.js";
import { markUserEmailVerifiedIfUnverified } from "./markUserEmailVerified.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";

const USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe.sequential("emailVerificationTokens (PGlite)", () => {
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
       values ($1::uuid, 'verify@example.test', 'legacy-hash-placeholder')`,
      [USER_ID],
    );
  });

  it("issues a token with bounded future expiry", async () => {
    const pool = pgliteAsPool(pglite);
    const before = Date.now();
    const { rawToken, expiresAt } = await issueEmailVerificationToken(pool, USER_ID);
    expect(rawToken.length).toBeGreaterThan(20);
    const skew = expiresAt.getTime() - before;
    expect(skew).toBeGreaterThanOrEqual(EMAIL_VERIFICATION_TOKEN_TTL_MS - 2_000);
    expect(skew).toBeLessThanOrEqual(EMAIL_VERIFICATION_TOKEN_TTL_MS + 5_000);
  });

  it("consumes a valid token once and runs the callback", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken } = await issueEmailVerificationToken(pool, USER_ID);
    const step = await withConsumedEmailVerificationToken(
      pool,
      { rawToken },
      async (_client, { userId }) => ({ userId, n: 1 }),
    );
    expect(step.ok).toBe(true);
    if (step.ok) {
      expect(step.value).toEqual({ userId: USER_ID, n: 1 });
    }
    const again = await withConsumedEmailVerificationToken(
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
    const { rawToken } = await issueEmailVerificationToken(pool, USER_ID);
    const past = Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS + 60_000;
    const step = await withConsumedEmailVerificationToken(
      pool,
      { rawToken, nowMs: past },
      async () => ({ n: 1 }),
    );
    expect(step.ok).toBe(false);
    if (!step.ok) {
      expect(step.reason).toBe("expired");
    }
    const retry = await withConsumedEmailVerificationToken(
      pool,
      { rawToken },
      async () => ({ n: 2 }),
    );
    expect(retry.ok).toBe(true);
  });

  it("rejects an invalid token", async () => {
    const pool = pgliteAsPool(pglite);
    const step = await withConsumedEmailVerificationToken(
      pool,
      { rawToken: "not-a-real-token-value-at-all-please" },
      async () => true,
    );
    expect(step.ok).toBe(false);
    if (!step.ok) {
      expect(step.reason).toBe("invalid_token");
    }
  });

  it("rolls back consumption when the guarded callback throws", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken } = await issueEmailVerificationToken(pool, USER_ID);
    await expect(
      withConsumedEmailVerificationToken(pool, { rawToken }, async () => {
        throw new Error("simulated failure before commit");
      }),
    ).rejects.toThrow("simulated failure before commit");

    const retry = await withConsumedEmailVerificationToken(
      pool,
      { rawToken },
      async () => "ok",
    );
    expect(retry.ok).toBe(true);
  });

  it("applies markUserEmailVerifiedIfUnverified inside consume (same wiring as verify-email API)", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken } = await issueEmailVerificationToken(pool, USER_ID);
    const step = await withConsumedEmailVerificationToken(
      pool,
      { rawToken },
      async (client, { userId }) => markUserEmailVerifiedIfUnverified(client, userId),
    );
    expect(step.ok).toBe(true);
    if (step.ok) {
      expect(step.value).toEqual({
        email: "verify@example.test",
        newlyVerified: true,
      });
    }
    const { rows } = await pglite.query<{ email_verified_at: string | null }>(
      `select email_verified_at from users where id = $1::uuid`,
      [USER_ID],
    );
    expect(rows[0]?.email_verified_at).not.toBeNull();
  });

  it("returns newlyVerified false when email was already verified (idempotent account state)", async () => {
    const pool = pgliteAsPool(pglite);
    const firstToken = await issueEmailVerificationToken(pool, USER_ID);
    const first = await withConsumedEmailVerificationToken(
      pool,
      { rawToken: firstToken.rawToken },
      async (client, { userId }) => markUserEmailVerifiedIfUnverified(client, userId),
    );
    expect(first.ok).toBe(true);

    const { rawToken: secondRaw } = await issueEmailVerificationToken(pool, USER_ID);
    const second = await withConsumedEmailVerificationToken(
      pool,
      { rawToken: secondRaw },
      async (client, { userId }) => markUserEmailVerifiedIfUnverified(client, userId),
    );
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.newlyVerified).toBe(false);
      expect(second.value.email).toBe("verify@example.test");
    }
  });

  // Contract for POST /api/me/resend-verification: each issue must revoke older links.
  it("replaces prior unconsumed tokens when issuing again", async () => {
    const pool = pgliteAsPool(pglite);
    const first = await issueEmailVerificationToken(pool, USER_ID);
    const second = await issueEmailVerificationToken(pool, USER_ID);
    expect(first.rawToken).not.toBe(second.rawToken);
    const stale = await withConsumedEmailVerificationToken(
      pool,
      { rawToken: first.rawToken },
      async () => "should-not-run",
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.reason).toBe("invalid_token");
    }
    const fresh = await withConsumedEmailVerificationToken(
      pool,
      { rawToken: second.rawToken },
      async () => "ok",
    );
    expect(fresh.ok).toBe(true);
  });
});
