import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  betaInviteLifecycleStateFromRecord,
  getBetaInviteById,
  getBetaInviteByIdForCreator,
  insertBetaInvite,
  insertUserWithBetaInviteRedemption,
  listBetaInvitesByLifecycleState,
  listBetaInvitesForAdmin,
  listBetaInvitesForCreator,
  revokeBetaInvite,
  revokeBetaInviteForAdmin,
  tryRedeemBetaInvite,
} from "./betaInvites.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";

const CREATOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REDEEMER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe.sequential("betaInvites (PGlite)", () => {
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
      `insert into users (id, email, password_hash) values
         ($1::uuid, 'creator@example.test', 'hash-c'),
         ($2::uuid, 'redeemer@example.test', 'hash-r'),
         ($3::uuid, 'other@example.test', 'hash-o')`,
      [CREATOR_ID, REDEEMER_ID, OTHER_ID],
    );
  });

  it("issues, lists by lifecycle, redeems once, and marks exhausted for single-use", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken, invite } = await insertBetaInvite(pool, {
      createdByUserId: CREATOR_ID,
      maxUses: 1,
    });
    expect(betaInviteLifecycleStateFromRecord(invite)).toBe("active");

    const activeForCreator = await listBetaInvitesForCreator(pool, {
      createdByUserId: CREATOR_ID,
      lifecycle: "active",
    });
    expect(activeForCreator).toHaveLength(1);

    const activeGlobal = await listBetaInvitesByLifecycleState(pool, {
      lifecycle: "active",
    });
    expect(activeGlobal.map((r) => r.id)).toContain(invite.id);

    const step = await tryRedeemBetaInvite(pool, {
      rawToken,
      redeemerUserId: REDEEMER_ID,
      redeemerEmail: "redeemer@example.test",
    });
    expect(step.ok).toBe(true);
    if (step.ok) {
      expect(step.invite.used_count).toBe(1);
      expect(betaInviteLifecycleStateFromRecord(step.invite)).toBe("exhausted");
    }

    const again = await tryRedeemBetaInvite(pool, {
      rawToken,
      redeemerUserId: OTHER_ID,
      redeemerEmail: "other@example.test",
    });
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.reason).toBe("exhausted");
    }
  });

  it("rejects email-locked invites when the redeemer email does not match", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken } = await insertBetaInvite(pool, {
      createdByUserId: CREATOR_ID,
      maxUses: 1,
      lockedEmail: "redeemer@example.test",
    });
    const step = await tryRedeemBetaInvite(pool, {
      rawToken,
      redeemerUserId: REDEEMER_ID,
      redeemerEmail: "wrong@example.test",
    });
    expect(step.ok).toBe(false);
    if (!step.ok) {
      expect(step.reason).toBe("email_lock_mismatch");
    }
  });

  it("revokes invites so redemption fails with revoked", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken, invite } = await insertBetaInvite(pool, {
      createdByUserId: CREATOR_ID,
      maxUses: 3,
    });
    const revoked = await revokeBetaInvite(pool, {
      inviteId: invite.id,
      createdByUserId: CREATOR_ID,
      reason: "operator",
    });
    expect(revoked).not.toBeNull();
    const step = await tryRedeemBetaInvite(pool, {
      rawToken,
      redeemerUserId: REDEEMER_ID,
      redeemerEmail: "redeemer@example.test",
    });
    expect(step.ok).toBe(false);
    if (!step.ok) {
      expect(step.reason).toBe("revoked");
    }
  });

  it("scopes getBetaInviteByIdForCreator to the owning user", async () => {
    const pool = pgliteAsPool(pglite);
    const { invite } = await insertBetaInvite(pool, {
      createdByUserId: CREATOR_ID,
      maxUses: 1,
    });
    const wrong = await getBetaInviteByIdForCreator(pool, {
      inviteId: invite.id,
      createdByUserId: REDEEMER_ID,
    });
    expect(wrong).toBeNull();
    const ok = await getBetaInviteByIdForCreator(pool, {
      inviteId: invite.id,
      createdByUserId: CREATOR_ID,
    });
    expect(ok?.id).toBe(invite.id);
  });

  it("admin helpers read and revoke invites without creator scoping", async () => {
    const pool = pgliteAsPool(pglite);
    const { invite } = await insertBetaInvite(pool, {
      createdByUserId: CREATOR_ID,
      maxUses: 2,
    });
    const fetched = await getBetaInviteById(pool, { inviteId: invite.id });
    expect(fetched?.id).toBe(invite.id);

    const allAdmin = await listBetaInvitesForAdmin(pool, { limit: 10 });
    expect(allAdmin.map((r) => r.id)).toContain(invite.id);

    const revoked = await revokeBetaInviteForAdmin(pool, {
      inviteId: invite.id,
      reason: "admin test",
    });
    expect(revoked?.revoked_at).not.toBeNull();

    const again = await revokeBetaInviteForAdmin(pool, {
      inviteId: invite.id,
      reason: "noop",
    });
    expect(again).toBeNull();
  });

  it("insertUserWithBetaInviteRedemption creates the user, records invite provenance, and consumes the invite", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken, invite } = await insertBetaInvite(pool, {
      createdByUserId: CREATOR_ID,
      maxUses: 1,
    });
    const client = await pool.connect();
    await client.query("begin");
    const step = await insertUserWithBetaInviteRedemption(client, {
      canonicalEmail: "fresh-signup@example.test",
      passwordHash: "pw-hash",
      rawInviteToken: rawToken,
    });
    expect(step.ok).toBe(true);
    if (!step.ok) {
      return;
    }
    expect(step.signupBetaInviteId).toBe(invite.id);
    await client.query("commit");

    const { rows: users } = await pglite.query<{ signup_beta_invite_id: string | null }>(
      `select signup_beta_invite_id from users where email = $1`,
      ["fresh-signup@example.test"],
    );
    expect(users[0]?.signup_beta_invite_id).toBe(invite.id);

    const after = await getBetaInviteById(pool, { inviteId: invite.id });
    expect(after?.used_count).toBe(1);

    const { rows: red } = await pglite.query(
      `select redeemed_user_id from beta_invite_redemptions where invite_id = $1::uuid`,
      [invite.id],
    );
    expect(red).toHaveLength(1);
  });

  it("insertUserWithBetaInviteRedemption rejects email-locked invites before inserting a user", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken } = await insertBetaInvite(pool, {
      createdByUserId: CREATOR_ID,
      maxUses: 1,
      lockedEmail: "expected@example.test",
    });
    const client = await pool.connect();
    await client.query("begin");
    const step = await insertUserWithBetaInviteRedemption(client, {
      canonicalEmail: "wrong@example.test",
      passwordHash: "pw-hash",
      rawInviteToken: rawToken,
    });
    expect(step.ok).toBe(false);
    if (step.ok) {
      return;
    }
    expect(step.reason).toBe("email_lock_mismatch");
    await client.query("rollback");

    const { rows: users } = await pglite.query(
      `select 1 from users where email = 'wrong@example.test'`,
    );
    expect(users).toHaveLength(0);
  });

  it("rejects redemption with invalid_token when the raw token does not match any row", async () => {
    const pool = pgliteAsPool(pglite);
    const step = await tryRedeemBetaInvite(pool, {
      rawToken: "not-a-matching-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      redeemerUserId: REDEEMER_ID,
      redeemerEmail: "redeemer@example.test",
    });
    expect(step.ok).toBe(false);
    if (!step.ok) {
      expect(step.reason).toBe("invalid_token");
    }
  });

  it("rejects redemption with expired when expires_at is in the past", async () => {
    const pool = pgliteAsPool(pglite);
    const past = new Date(Date.now() - 86_400_000);
    const { rawToken } = await insertBetaInvite(pool, {
      createdByUserId: CREATOR_ID,
      maxUses: 3,
      expiresAt: past,
    });
    const step = await tryRedeemBetaInvite(pool, {
      rawToken,
      redeemerUserId: REDEEMER_ID,
      redeemerEmail: "redeemer@example.test",
    });
    expect(step.ok).toBe(false);
    if (!step.ok) {
      expect(step.reason).toBe("expired");
    }
  });

  it("rejects already_redeemed when the same user redeems twice on a multi-use invite", async () => {
    const pool = pgliteAsPool(pglite);
    const { rawToken } = await insertBetaInvite(pool, {
      createdByUserId: CREATOR_ID,
      maxUses: 3,
    });
    const first = await tryRedeemBetaInvite(pool, {
      rawToken,
      redeemerUserId: REDEEMER_ID,
      redeemerEmail: "redeemer@example.test",
    });
    expect(first.ok).toBe(true);

    const second = await tryRedeemBetaInvite(pool, {
      rawToken,
      redeemerUserId: REDEEMER_ID,
      redeemerEmail: "redeemer@example.test",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("already_redeemed");
    }
  });

  it("rejects insertBetaInvite when maxUses is not a positive integer", async () => {
    const pool = pgliteAsPool(pglite);
    await expect(
      insertBetaInvite(pool, { createdByUserId: CREATOR_ID, maxUses: 0 }),
    ).rejects.toThrow(/maxUses/);
  });
});
