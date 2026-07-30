import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import { createExportJob } from "./exportJobs.js";

const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe.sequential("export_jobs one active row per user (PGlite)", () => {
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
      "TRUNCATE TABLE sessions, listens, import_jobs, export_jobs, users, tracks, albums, artists CASCADE",
    );
    await pglite.query(
      `insert into users (id, email, password_hash)
       values ($1::uuid, 'u@test', 'hash')`,
      [USER_ID],
    );
  });

  it("rejects a second queued export for the same user", async () => {
    const pool = pgliteAsPool(pglite);
    await createExportJob(pool, { userId: USER_ID, format: "json" });
    await expect(
      createExportJob(pool, { userId: USER_ID, format: "csv" }),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
