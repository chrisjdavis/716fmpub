import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import { createExportJob, getExportJobByIdForUser } from "./exportJobs.js";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe.sequential("export_jobs account scoping (PGlite)", () => {
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
      `insert into users (id, email, password_hash) values
       ($1::uuid, 'a@test', 'hash'),
       ($2::uuid, 'b@test', 'hash')`,
      [USER_A, USER_B],
    );
  });

  it("getExportJobByIdForUser returns null when the job belongs to another user", async () => {
    const pool = pgliteAsPool(pglite);
    const { id: exportB } = await createExportJob(pool, {
      userId: USER_B,
      format: "json",
    });
    const row = await getExportJobByIdForUser(pool, {
      exportJobId: exportB,
      userId: USER_A,
    });
    expect(row).toBeNull();
  });

  it("getExportJobByIdForUser returns the row for the owning user", async () => {
    const pool = pgliteAsPool(pglite);
    const { id: exportB } = await createExportJob(pool, {
      userId: USER_B,
      format: "json",
    });
    const row = await getExportJobByIdForUser(pool, {
      exportJobId: exportB,
      userId: USER_B,
    });
    expect(row).not.toBeNull();
    expect(row?.userId).toBe(USER_B);
  });
});
