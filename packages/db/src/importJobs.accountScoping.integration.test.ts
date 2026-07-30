import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import { createImportJob, getImportJobByIdForUser } from "./importJobs.js";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe.sequential("import_jobs account scoping (PGlite)", () => {
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

  it("getImportJobByIdForUser returns null when the job belongs to another user (source=user)", async () => {
    const pool = pgliteAsPool(pglite);
    const { id: jobB } = await createImportJob(pool, {
      userId: USER_B,
      label: "b-import",
      lastfmUsername: "lf",
    });
    const row = await getImportJobByIdForUser(pool, {
      jobId: jobB,
      userId: USER_A,
      source: "user",
    });
    expect(row).toBeNull();
  });

  it("getImportJobByIdForUser returns the row for the owning user", async () => {
    const pool = pgliteAsPool(pglite);
    const { id: jobB } = await createImportJob(pool, {
      userId: USER_B,
      label: "b-import",
      lastfmUsername: "lf",
    });
    const row = await getImportJobByIdForUser(pool, {
      jobId: jobB,
      userId: USER_B,
      source: "user",
    });
    expect(row).not.toBeNull();
    expect(row?.user_id).toBe(USER_B);
  });
});
