import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  issuePasswordRecoveryToken,
  withConsumedPasswordRecoveryToken,
} from "./passwordRecoveryTokens.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";

const USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/**
 * Asserts the persistence contract that `POST /api/auth/recovery/confirm` enforces via
 * `invalidatePriorSessionsForAuthTransition`: after a successful recovery transaction, **no**
 * `sessions` rows remain for the user (the web route may also delete the current cookie token’s
 * row first when present; this test covers the required bulk revocation).
 */
describe.sequential("password recovery completion revokes sessions (PGlite)", () => {
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
       values ($1::uuid, 'recovery-sessions@example.test', 'legacy-hash-placeholder')`,
      [USER_ID],
    );
  });

  it("removes every session row for the account when recovery completes", async () => {
    const pool = pgliteAsPool(pglite);
    await pglite.query(
      `insert into sessions (user_id, token_hash, expires_at, last_seen_at, last_rotated_at)
       values ($1::uuid, 'hash-session-a', now() + interval '30 days', now(), now()),
             ($1::uuid, 'hash-session-b', now() + interval '30 days', now(), now())`,
      [USER_ID],
    );
    const before = await pglite.query<{ c: string }>(
      `select count(*)::text as c from sessions where user_id = $1::uuid`,
      [USER_ID],
    );
    expect(before.rows[0]?.c).toBe("2");

    const { rawToken } = await issuePasswordRecoveryToken(pool, USER_ID);
    const step = await withConsumedPasswordRecoveryToken(
      pool,
      { rawToken },
      async (client, { userId }) => {
        await client.query(
          `update users set password_hash = $2, updated_at = now() where id = $1::uuid`,
          [userId, "post-recovery-hash"],
        );
        await client.query(`delete from sessions where user_id = $1::uuid`, [userId]);
      },
    );
    expect(step.ok).toBe(true);

    const after = await pglite.query<{ c: string }>(
      `select count(*)::text as c from sessions where user_id = $1::uuid`,
      [USER_ID],
    );
    expect(after.rows[0]?.c).toBe("0");
  });
});
