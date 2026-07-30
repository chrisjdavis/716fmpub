import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyBootstrapAccountRole } from "./bootstrapAccountRole.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";

describe.sequential("applyBootstrapAccountRole (PGlite)", () => {
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
  });

  it("promotes a matched user to owner", async () => {
    await pglite.query(
      `insert into users (id, email, password_hash) values ($1::uuid, $2, 'x')`,
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ops@example.test"],
    );
    const pool = pgliteAsPool(pglite);
    const out = await applyBootstrapAccountRole(pool, {
      email: "Ops@Example.Test",
      targetRole: "owner",
    });
    expect(out.ok && !out.skipped).toBe(true);
    if (out.ok && !out.skipped) {
      expect(out.didUpdate).toBe(true);
      expect(out.newRole).toBe("owner");
    }
    const { rows } = await pglite.query<{ account_role: string }>(
      `select account_role from users where id = $1::uuid`,
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    );
    expect(rows[0]?.account_role).toBe("owner");
  });

  it("is idempotent when the role already matches", async () => {
    await pglite.query(
      `insert into users (id, email, password_hash, account_role) values ($1::uuid, $2, 'x', 'owner')`,
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ops@example.test"],
    );
    const pool = pgliteAsPool(pglite);
    const out = await applyBootstrapAccountRole(pool, {
      email: "ops@example.test",
      targetRole: "owner",
    });
    expect(out.ok && !out.skipped).toBe(true);
    if (out.ok && !out.skipped) {
      expect(out.didUpdate).toBe(false);
    }
  });

  it("returns user_not_found for unknown email", async () => {
    const pool = pgliteAsPool(pglite);
    const out = await applyBootstrapAccountRole(pool, {
      email: "missing@example.test",
      targetRole: "admin",
    });
    expect(out).toEqual({
      ok: false,
      error: "user_not_found",
      email: "missing@example.test",
    });
  });

  it("refuses bootstrap when account_status is not active", async () => {
    await pglite.query(
      `insert into users (id, email, password_hash, account_status) values ($1::uuid, $2, 'x', 'suspended')`,
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ops@example.test"],
    );
    const pool = pgliteAsPool(pglite);
    const out = await applyBootstrapAccountRole(pool, {
      email: "ops@example.test",
      targetRole: "owner",
    });
    expect(out).toEqual({
      ok: false,
      error: "account_not_active",
      email: "ops@example.test",
    });
  });
});
