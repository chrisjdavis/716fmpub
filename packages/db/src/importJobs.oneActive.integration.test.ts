import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import { createImportJob } from "./importJobs.js";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe.sequential("import_jobs one active row per user (PGlite)", () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
    await applyMigrationsToPglite(pglite);
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(async () => {
    await pglite.exec(
      "TRUNCATE TABLE sessions, listens, import_jobs, users, tracks, albums, artists CASCADE",
    );
    await pglite.query(
      `insert into users (id, email, password_hash)
       values ($1::uuid, 'u@test', 'hash')`,
      [USER_ID],
    );
  });

  it("rejects a second queued import for the same user", async () => {
    const pool = pgliteAsPool(pglite);
    await createImportJob(pool, {
      userId: USER_ID,
      label: "a",
      lastfmUsername: "lf",
    });
    await expect(
      createImportJob(pool, {
        userId: USER_ID,
        label: "b",
        lastfmUsername: "lf",
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
