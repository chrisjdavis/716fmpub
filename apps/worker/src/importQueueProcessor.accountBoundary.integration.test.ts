import { type Job } from "bullmq";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import { parseServerEnv } from "@vs/env";
import { applyMigrationsToPglite, pgliteAsPool } from "@vs/db/test/pgliteHarness";
import { IMPORTS_QUEUE_JOB_NAME } from "@vs/queue";

import { processImportsJob } from "./importQueueProcessor.js";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const env: ServerEnv = parseServerEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/testdb",
  REDIS_URL: "redis://127.0.0.1:6379",
  EXPORT_ARTIFACTS_DIR: "/tmp",
  LASTFM_API_KEY: "",
  LISTEN_SYNC_USER_MIN_INTERVAL_SEC: "120",
  LISTEN_REALTIME_PORT: "3457",
  IMPORT_LASTFM_PAGE_MIN_INTERVAL_MS: "0",
  FEATURE_FLAGS: "{}",
});

function jobFor(data: { importJobId: string; userId: string }): Job {
  return {
    id: "bmq-boundary",
    name: IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT,
    data,
  } as unknown as Job;
}

describe.sequential("importQueueProcessor account boundary (PGlite)", () => {
  let pglite: PGlite;
  let pool: Pool;

  beforeAll(async () => {
    pglite = new PGlite();
    await applyMigrationsToPglite(pglite);
    pool = pgliteAsPool(pglite) as unknown as Pool;
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

  it("does not run when payload userId does not own the import_jobs row", async () => {
    const { rows } = await pglite.query<{ id: string }>(
      `insert into import_jobs (user_id, label, lastfm_username, stage, source)
       values ($1::uuid, 'b', 'lf', 'queued', 'user')
       returning id`,
      [USER_B],
    );
    const importJobId = String(rows[0]?.id);
    await expect(
      processImportsJob(jobFor({ importJobId, userId: USER_A }), pool, env),
    ).rejects.toThrow(/no user-scoped import job/);

    const stageRes = await pglite.query<{ stage: string }>(
      `select stage from import_jobs where id = $1::uuid`,
      [importJobId],
    );
    expect(stageRes.rows[0]?.stage).toBe("queued");
  });

  it("does not run system_sync rows on the imports queue", async () => {
    const { rows } = await pglite.query<{ id: string }>(
      `insert into import_jobs (user_id, label, lastfm_username, stage, source)
       values ($1::uuid, 'sync', 'lf', 'queued', 'system_sync')
       returning id`,
      [USER_A],
    );
    const importJobId = String(rows[0]?.id);
    await expect(
      processImportsJob(
        jobFor({ importJobId, userId: USER_A }),
        pool,
        env,
      ),
    ).rejects.toThrow(/no user-scoped import job/);
  });
});
