import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import { tryEnqueueListenCatchupJobForUser } from "./listenSync.js";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_IMPORT_JOB_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const ARTIST_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ALBUM_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TRACK_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LISTEN_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

describe.sequential("tryEnqueueListenCatchupJobForUser (PGlite)", () => {
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
      `insert into users (
         id, email, password_hash, lastfm_username, lastfm_api_key
       ) values (
         $1::uuid,
         'catchup@example.test',
         'not-a-real-hash',
         'lfuser',
         'user-api-key'
       )`,
      [USER_ID],
    );
    await pglite.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username, source)
       values ($1::uuid, $2::uuid, 'done', 'completed', 'lfuser', 'user')`,
      [USER_IMPORT_JOB_ID, USER_ID],
    );
    await pglite.query(
      `insert into artists (id, name, musicbrainz_artist_mbid, name_key, updated_at)
       values ($1::uuid, 'Artist', null, 'artist', now())`,
      [ARTIST_ID],
    );
    await pglite.query(
      `insert into albums (id, artist_id, title, title_key, musicbrainz_release_mbid, updated_at)
       values ($1::uuid, $2::uuid, 'Album', 'album', null, now())`,
      [ALBUM_ID, ARTIST_ID],
    );
    await pglite.query(
      `insert into tracks (id, artist_id, album_id, title, title_key, musicbrainz_recording_mbid, updated_at)
       values ($1::uuid, $2::uuid, $3::uuid, 'Track', 'track', null, now())`,
      [TRACK_ID, ARTIST_ID, ALBUM_ID],
    );
    await pglite.query(
      `insert into listens (id, user_id, track_id, played_at, created_at)
       values ($1::uuid, $2::uuid, $3::uuid, now() - interval '1 day', now())`,
      [LISTEN_ID, USER_ID, TRACK_ID],
    );
  });

  it("enqueues a system_sync import when eligible", async () => {
    const pool = pgliteAsPool(pglite);
    const out = await tryEnqueueListenCatchupJobForUser(pool, {
      userId: USER_ID,
      trigger: "manual",
      minIntervalSeconds: 300,
      workerHasSharedLastfmApiKey: false,
    });
    expect(out).toEqual({ ok: true, importJobId: expect.any(String) });

    const { rows } = await pglite.query<{ stage: string; source: string }>(
      `select stage, source from import_jobs where id = $1::uuid`,
      [out.ok ? out.importJobId : ""],
    );
    expect(rows[0]?.stage).toBe("queued");
    expect(rows[0]?.source).toBe("system_sync");
  });

  it("refuses a second enqueue while an import is queued", async () => {
    const pool = pgliteAsPool(pglite);
    const first = await tryEnqueueListenCatchupJobForUser(pool, {
      userId: USER_ID,
      trigger: "manual",
      minIntervalSeconds: 300,
      workerHasSharedLastfmApiKey: false,
    });
    expect(first.ok).toBe(true);

    const second = await tryEnqueueListenCatchupJobForUser(pool, {
      userId: USER_ID,
      trigger: "manual",
      minIntervalSeconds: 300,
      workerHasSharedLastfmApiKey: false,
    });
    expect(second).toEqual({
      ok: false,
      reason: "import_already_queued_or_running",
    });
  });

  it("returns no_lastfm_api_key_for_account when no keys exist", async () => {
    await pglite.query(
      `update users set lastfm_api_key = null where id = $1::uuid`,
      [USER_ID],
    );
    const pool = pgliteAsPool(pglite);
    const out = await tryEnqueueListenCatchupJobForUser(pool, {
      userId: USER_ID,
      trigger: "manual",
      minIntervalSeconds: 300,
      workerHasSharedLastfmApiKey: false,
    });
    expect(out).toEqual({ ok: false, reason: "no_lastfm_api_key_for_account" });
  });

  it("applies min interval for scheduled trigger", async () => {
    const pool = pgliteAsPool(pglite);
    await tryEnqueueListenCatchupJobForUser(pool, {
      userId: USER_ID,
      trigger: "manual",
      minIntervalSeconds: 300,
      workerHasSharedLastfmApiKey: false,
    });
    await pglite.query(
      `update import_jobs set stage = 'completed' where user_id = $1::uuid and source = 'system_sync'`,
      [USER_ID],
    );

    await pglite.query(
      `update users set last_listen_sync_attempt_at = now() where id = $1::uuid`,
      [USER_ID],
    );

    const scheduled = await tryEnqueueListenCatchupJobForUser(pool, {
      userId: USER_ID,
      trigger: "scheduled",
      minIntervalSeconds: 86_400,
      workerHasSharedLastfmApiKey: false,
    });
    expect(scheduled).toEqual({
      ok: false,
      reason: "listen_sync_interval_not_elapsed",
    });

    const manual = await tryEnqueueListenCatchupJobForUser(pool, {
      userId: USER_ID,
      trigger: "manual",
      minIntervalSeconds: 86_400,
      workerHasSharedLastfmApiKey: false,
    });
    expect(manual.ok).toBe(true);
  });
});
