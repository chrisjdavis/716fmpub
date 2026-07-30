import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";

describe.sequential("users.product_plan (PGlite)", () => {
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

  it("defaults new rows to core", async () => {
    await pglite.query(
      `insert into users (id, email, password_hash) values ($1::uuid, $2, 'x')`,
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "u@example.test"],
    );
    const { rows } = await pglite.query<{ product_plan: string }>(
      `select product_plan from users where id = $1::uuid`,
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    );
    expect(rows[0]?.product_plan).toBe("core");
  });

  it("allows advanced and rejects invalid plan values", async () => {
    await pglite.query(
      `insert into users (id, email, password_hash, product_plan) values ($1::uuid, $2, 'x', 'advanced')`,
      ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "adv@example.test"],
    );
    await expect(
      pglite.query(
        `insert into users (id, email, password_hash, product_plan) values ($1::uuid, $2, 'x', 'enterprise')`,
        ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "bad@example.test"],
      ),
    ).rejects.toThrow(/violates check constraint|check constraint/i);
  });
});
