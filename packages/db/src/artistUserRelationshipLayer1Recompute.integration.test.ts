import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import { recomputeArtistUserRelationshipLayer1ForUser30dTop } from "./artistUserRelationshipLayer1Recompute.js";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ARTIST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALBUM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TRACK_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
/** Valid artist MBID (fixture-aligned). */
const ARTIST_MBID = "6de884b6-2a32-4d25-8d2b-24081c513191";

describe.sequential("recomputeArtistUserRelationshipLayer1ForUser30dTop (PGlite)", () => {
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
      `insert into users (id, email, password_hash) values ($1::uuid, 'layer1-cap@example.test', 'x')`,
      [USER_ID],
    );
    await pglite.query(
      `insert into artists (id, name, name_key, musicbrainz_artist_mbid)
       values ($1::uuid, 'Cap Artist', 'cap artist', $2)`,
      [ARTIST_ID, ARTIST_MBID],
    );
    await pglite.query(
      `insert into albums (id, artist_id, title, title_key)
       values ($1::uuid, $2::uuid, 'Cap Album', 'cap album')`,
      [ALBUM_ID, ARTIST_ID],
    );
    await pglite.query(
      `insert into tracks (id, artist_id, album_id, title, title_key)
       values ($1::uuid, $2::uuid, $3::uuid, 'Cap Track', 'cap track')`,
      [TRACK_ID, ARTIST_ID, ALBUM_ID],
    );
  });

  it("skips an artist when window plays exceed the processing cap", async () => {
    const pool = pgliteAsPool(pglite);
    const nowMs = Date.parse("2026-04-15T12:00:00.000Z");
    const baseMs = Date.parse("2026-04-14T08:00:00.000Z");
    const nListens = 7;
    const cap = 5;
    for (let i = 0; i < nListens; i += 1) {
      const playedAt = new Date(baseMs + i * 1000).toISOString();
      await pglite.query(
        `insert into listens (user_id, track_id, played_at) values ($1::uuid, $2::uuid, $3::timestamptz)`,
        [USER_ID, TRACK_ID, playedAt],
      );
    }

    const result = await recomputeArtistUserRelationshipLayer1ForUser30dTop(pool, {
      userId: USER_ID,
      nowMs,
      artistLimit: 1,
      windowPlaysFetchCap: cap,
    });

    expect(result.userSkipped).toBeNull();
    expect(result.artistOutcomes).toHaveLength(1);
    expect(result.artistOutcomes[0]).toEqual({
      kind: "skip",
      reason: "window_plays_exceed_processing_cap",
    });
  });
});
