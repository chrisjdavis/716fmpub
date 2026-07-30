import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import {
  claimWelcomeEmailDispatchSlot,
  releaseWelcomeEmailDispatchSlot,
} from "./welcomeEmailDispatch.js";

const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe.sequential("welcomeEmailDispatch (PGlite)", () => {
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
       values ($1::uuid, 'welcome@example.test', 'legacy-hash-placeholder')`,
      [USER_ID],
    );
  });

  it("claims once and returns null on second claim", async () => {
    const pool = pgliteAsPool(pglite);
    const first = await claimWelcomeEmailDispatchSlot(pool, USER_ID);
    expect(first).toEqual({ email: "welcome@example.test" });
    const second = await claimWelcomeEmailDispatchSlot(pool, USER_ID);
    expect(second).toBeNull();
  });

  it("releaseWelcomeEmailDispatchSlot allows a new claim", async () => {
    const pool = pgliteAsPool(pglite);
    await claimWelcomeEmailDispatchSlot(pool, USER_ID);
    await releaseWelcomeEmailDispatchSlot(pool, USER_ID);
    const again = await claimWelcomeEmailDispatchSlot(pool, USER_ID);
    expect(again).toEqual({ email: "welcome@example.test" });
  });
});
