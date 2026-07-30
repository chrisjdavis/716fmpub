import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertBetaInvite } from "./betaInvites.js";
import {
  adminUserListDecodedCursorMatchesFingerprint,
  adminUserListRequestFingerprintFromArgs,
  encodeAdminUserListCursor,
  listUsersForAdmin,
  tryDecodeAdminUserListCursor,
} from "./adminUsersList.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";

const CREATOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";

describe.sequential("adminUsersList (PGlite)", () => {
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
      `insert into users (id, email, password_hash, created_at)
       values ($1::uuid, 'creator@test', 'h', '2000-01-01T00:00:00.000Z')`,
      [CREATOR_ID],
    );
  });

  it("lists users newest-first with role, status, and created_at", async () => {
    const pool = pgliteAsPool(pglite);
    await pglite.query(
      `insert into users (id, email, password_hash, display_name, account_role, account_status, created_at)
       values ($1::uuid, 'alice@test', 'h', 'Alice Display', 'user', 'active', '2026-01-02T00:00:00.000Z'),
              ($2::uuid, 'bob@test', 'h', null, 'admin', 'suspended', '2026-01-01T00:00:00.000Z')`,
      [U1, U2],
    );
    const { users, nextCursor } = await listUsersForAdmin(pool, { limit: 10 });
    expect(nextCursor).toBeNull();
    expect(users.map((u) => u.email)).toEqual(["alice@test", "bob@test", "creator@test"]);
    const alice = users.find((u) => u.id === U1);
    expect(alice?.account_role).toBe("user");
    expect(alice?.account_status).toBe("active");
    expect(alice?.display_name).toBe("Alice Display");
    expect(alice?.product_plan).toBe("core");
    expect(users.find((u) => u.id === U2)?.product_plan).toBe("core");
  });

  it("filters by email, display_name, or lastfm_username substring", async () => {
    const pool = pgliteAsPool(pglite);
    await pglite.query(
      `insert into users (id, email, password_hash, display_name, lastfm_username, created_at)
       values ($1::uuid, 'zoe@test', 'h', 'Other', 'targetuser', '2026-01-01T00:00:00.000Z'),
              ($2::uuid, 'ann@test', 'h', 'Target Name', null, '2026-01-02T00:00:00.000Z')`,
      [U1, U2],
    );
    const byEmail = await listUsersForAdmin(pool, { q: "ann@", limit: 20 });
    expect(byEmail.users.map((u) => u.id)).toEqual([U2]);

    const byDisplay = await listUsersForAdmin(pool, { q: "target n", limit: 20 });
    expect(byDisplay.users.map((u) => u.id)).toEqual([U2]);

    const byLf = await listUsersForAdmin(pool, { q: "targetuser", limit: 20 });
    expect(byLf.users.map((u) => u.id)).toEqual([U1]);
  });

  it("returns signup invite provenance when signup_beta_invite_id is set", async () => {
    const pool = pgliteAsPool(pglite);
    const { invite } = await insertBetaInvite(pool, {
      createdByUserId: CREATOR_ID,
      maxUses: 5,
      lockedEmail: "locked@invite.test",
    });
    await pglite.query(
      `insert into users (id, email, password_hash, signup_beta_invite_id, created_at)
       values ($1::uuid, 'invited@test', 'h', $2::uuid, '2026-01-03T00:00:00.000Z')`,
      [U1, invite.id],
    );
    const { users } = await listUsersForAdmin(pool, { q: "invited", limit: 10 });
    expect(users).toHaveLength(1);
    const row = users[0]!;
    expect(row.signup_beta_invite_id).toBe(invite.id);
    expect(row.invite_locked_email).toBe("locked@invite.test");
    expect(row.invite_created_by_user_id).toBe(CREATOR_ID);
    expect(row.invite_created_at).toBeTruthy();
  });

  it("paginates with nextCursor and accepts cursor on the following page", async () => {
    const pool = pgliteAsPool(pglite);
    await pglite.query(
      `insert into users (id, email, password_hash, created_at) values
         ($1::uuid, 'p1@test', 'h', '2026-01-01T00:00:00.000Z'),
         ($2::uuid, 'p2@test', 'h', '2026-01-01T00:00:01.000Z'),
         ($3::uuid, 'p3@test', 'h', '2026-01-01T00:00:02.000Z')`,
      [U1, U2, U3],
    );
    const first = await listUsersForAdmin(pool, { limit: 2 });
    expect(first.users.map((u) => u.email)).toEqual(["p3@test", "p2@test"]);
    expect(first.nextCursor).not.toBeNull();
    expect(tryDecodeAdminUserListCursor(first.nextCursor)).not.toBeNull();

    const second = await listUsersForAdmin(pool, {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.users.map((u) => u.email)).toEqual(["p1@test", "creator@test"]);
    expect(second.nextCursor).toBeNull();
  });

  it("filters by product_plan", async () => {
    const pool = pgliteAsPool(pglite);
    await pglite.query(
      `insert into users (id, email, password_hash, product_plan, created_at)
       values ($1::uuid, 'adv@test', 'h', 'advanced', '2026-01-02T00:00:00.000Z'),
              ($2::uuid, 'cor@test', 'h', 'core', '2026-01-01T00:00:00.000Z')`,
      [U1, U2],
    );
    const adv = await listUsersForAdmin(pool, { productPlan: "advanced", limit: 20 });
    expect(adv.users.map((u) => u.id)).toEqual([U1]);
    const coreOnly = await listUsersForAdmin(pool, { productPlan: "core", limit: 20 });
    expect(coreOnly.users.some((u) => u.id === U1)).toBe(false);
    expect(coreOnly.users.some((u) => u.id === U2)).toBe(true);
  });

  it("paginates with product_plan filter using v2 cursors", async () => {
    const pool = pgliteAsPool(pglite);
    await pglite.query(
      `insert into users (id, email, password_hash, product_plan, created_at) values
         ($1::uuid, 'a1@test', 'h', 'advanced', '2026-01-01T00:00:02.000Z'),
         ($2::uuid, 'a2@test', 'h', 'advanced', '2026-01-01T00:00:01.000Z'),
         ($3::uuid, 'c1@test', 'h', 'core', '2026-01-01T00:00:03.000Z')`,
      [U1, U2, U3],
    );
    const first = await listUsersForAdmin(pool, { productPlan: "advanced", limit: 1 });
    expect(first.users).toHaveLength(1);
    expect(first.users[0]?.product_plan).toBe("advanced");
    expect(first.nextCursor).not.toBeNull();
    const second = await listUsersForAdmin(pool, {
      productPlan: "advanced",
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.users).toHaveLength(1);
    expect(second.users[0]?.id).not.toBe(first.users[0]?.id);
    expect(second.users[0]?.product_plan).toBe("advanced");
  });

  it("round-trips encode/decode v2 cursor with fingerprint", () => {
    const fp = adminUserListRequestFingerprintFromArgs({
      q: "needle",
      productPlan: "advanced",
    });
    const enc = encodeAdminUserListCursor(
      { createdAt: "2026-01-01T00:00:00.000Z", id: U1 },
      fp,
    );
    const dec = tryDecodeAdminUserListCursor(enc);
    expect(dec).not.toBeNull();
    expect(dec?.legacyV1).toBe(false);
    expect(dec?.productPlan).toBe("advanced");
    expect(dec?.q).toBe("needle");
    expect(adminUserListDecodedCursorMatchesFingerprint(dec!, fp)).toBe(true);
    expect(tryDecodeAdminUserListCursor("not-base64")).toBeNull();
  });

  it("decodes legacy v1 cursors for fingerprint without product plan filter", () => {
    const legacyJson = JSON.stringify({
      v: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      id: U1,
    });
    const enc = Buffer.from(legacyJson, "utf8").toString("base64url");
    const dec = tryDecodeAdminUserListCursor(enc);
    expect(dec?.legacyV1).toBe(true);
    expect(
      adminUserListDecodedCursorMatchesFingerprint(
        dec!,
        adminUserListRequestFingerprintFromArgs({}),
      ),
    ).toBe(true);
    expect(
      adminUserListDecodedCursorMatchesFingerprint(
        dec!,
        adminUserListRequestFingerprintFromArgs({ productPlan: "core" }),
      ),
    ).toBe(false);
    expect(
      adminUserListDecodedCursorMatchesFingerprint(
        dec!,
        adminUserListRequestFingerprintFromArgs({ q: "needle" }),
      ),
    ).toBe(false);
  });
});
