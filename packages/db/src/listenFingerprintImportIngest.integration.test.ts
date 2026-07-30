import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import { getListenFingerprintForUser } from "./listenSync.js";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const RAW_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RAW_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe.sequential("listen fingerprint import ingest signals (PGlite)", () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
    await applyMigrationsToPglite(pglite);
  });

  afterAll(async () => {
    await pglite.close();
  });

  it("includes raw ingest counts while listens are still empty", async () => {
    await pglite.exec("TRUNCATE TABLE raw_scrobbles, listens, import_jobs, users CASCADE");
    await pglite.query(
      `insert into users (id, email, password_hash)
       values ($1::uuid, 'ingest-fp@example.test', 'not-a-real-hash')`,
      [USER_ID],
    );
    await pglite.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username, source)
       values ($1::uuid, $2::uuid, 'ingest', 'running', 'lfuser', 'user')`,
      [JOB_ID, USER_ID],
    );
    await pglite.query(
      `insert into raw_scrobbles (
         id, import_job_id, user_id, uts, played_at,
         artist_name, track_name, source_event_hash, canonicalization_status, raw_payload
       )
       values
         ($1::uuid, $2::uuid, $3::uuid, 1001, now() - interval '1 year',
          'Artist A', 'Track A', 'hash-a', 'pending', '{}'::jsonb),
         ($4::uuid, $2::uuid, $3::uuid, 1002, now() - interval '2 years',
          'Artist B', 'Track B', 'hash-b', 'pending', '{}'::jsonb)`,
      [RAW_A, JOB_ID, USER_ID, RAW_B],
    );

    const pool = pgliteAsPool(pglite);
    const fp = await getListenFingerprintForUser(pool, USER_ID);
    expect(fp.listen_count).toBe("0");
    expect(fp.max_played_at).toBeNull();
    expect(fp.ingest_raw_rows).toBe("2");
    expect(fp.import_job_touch).toEqual(expect.any(String));
  });
});
