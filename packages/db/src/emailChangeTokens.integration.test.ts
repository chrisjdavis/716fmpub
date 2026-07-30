import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  applyVerifiedEmailChange,
  EMAIL_CHANGE_TOKEN_TTL_MS,
  EmailChangeCompletionBlockedError,
  issueEmailChangeToken,
  withConsumedEmailChangeToken,
} from "./emailChangeTokens.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe.sequential("emailChangeTokens (PGlite)", () => {
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
      `insert into users (id, email, password_hash, email_verified_at)
       values ($1::uuid, 'a@example.test', 'h', now()),
              ($2::uuid, 'b@example.test', 'h', now())`,
      [USER_A, USER_B],
    );
  });

  it("issues a token with bounded future expiry", async () => {
    const pool = pgliteAsPool(pglite);
    const before = Date.now();
    const { rawToken, expiresAt } = await issueEmailChangeToken(pool, USER_A, "new@example.test");
    expect(rawToken.length).toBeGreaterThan(20);
    const skew = expiresAt.getTime() - before;
    expect(skew).toBeGreaterThanOrEqual(EMAIL_CHANGE_TOKEN_TTL_MS - 2_000);
    expect(skew).toBeLessThanOrEqual(EMAIL_CHANGE_TOKEN_TTL_MS + 5_000);
  });

  it("consumes token and updates email plus verified timestamp", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken } = await issueEmailChangeToken(pool, USER_A, "fresh@example.test");
    const step = await withConsumedEmailChangeToken(
      pool,
      { rawToken },
      async (client, { userId, newEmail }) =>
        applyVerifiedEmailChange(client, { userId, newEmail }),
    );
    expect(step.ok).toBe(true);
    if (!step.ok) {
      return;
    }
    expect(step.value.email).toBe("fresh@example.test");
    const { rows } = await pglite.query<{ email: string; email_verified_at: string | null }>(
      `select email, email_verified_at from users where id = $1::uuid`,
      [USER_A],
    );
    expect(rows[0]?.email).toBe("fresh@example.test");
    expect(rows[0]?.email_verified_at).not.toBeNull();
  });

  it("rejects completion when another account owns the target email", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken } = await issueEmailChangeToken(pool, USER_A, "b@example.test");
    await expect(
      withConsumedEmailChangeToken(pool, { rawToken }, async (client, { userId, newEmail }) =>
        applyVerifiedEmailChange(client, { userId, newEmail }),
      ),
    ).rejects.toBeInstanceOf(EmailChangeCompletionBlockedError);
    const { rows } = await pglite.query<{ open: boolean }>(
      `select (consumed_at is null) as open from email_change_tokens where user_id = $1::uuid`,
      [USER_A],
    );
    expect(rows[0]?.open).toBe(true);
  });

  it("supersedes prior unconsumed tokens for the same user", async () => {
    const pool = pgliteAsPool(pglite);
    const first = await issueEmailChangeToken(pool, USER_A, "one@example.test");
    const second = await issueEmailChangeToken(pool, USER_A, "two@example.test");
    const { rows: cnt } = await pglite.query<{ n: string }>(
      `select count(*)::text as n from email_change_tokens where user_id = $1::uuid and consumed_at is null`,
      [USER_A],
    );
    expect(cnt[0]?.n).toBe("1");

    const step = await withConsumedEmailChangeToken(
      pool,
      { rawToken: second.rawToken },
      async (client, { userId, newEmail }) =>
        applyVerifiedEmailChange(client, { userId, newEmail }),
    );
    expect(step.ok).toBe(true);

    const stale = await withConsumedEmailChangeToken(
      pool,
      { rawToken: first.rawToken },
      async (client, { userId, newEmail }) =>
        applyVerifiedEmailChange(client, { userId, newEmail }),
    );
    expect(stale.ok).toBe(false);
    if (stale.ok) {
      return;
    }
    expect(stale.reason).toBe("invalid_token");
  });
});
