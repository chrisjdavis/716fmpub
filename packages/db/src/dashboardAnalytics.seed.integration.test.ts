import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalizePendingRawScrobblesBatch } from "./canonicalizeRawScrobbles.js";
import {
  getDashboardListenSummary,
  getDashboardRecentListens,
  playedAtLowerBoundUtc,
} from "./dashboardAnalytics.js";
import { batchInsertRawScrobbles, type RawImportListenRow } from "./rawScrobbles.js";
import {
  ANALYTICS_FIXTURE_NOW_MS,
  duplicateHashRows,
  realisticLastfmImportRows,
} from "./test/analyticsImportFixtures.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

describe.sequential("dashboardAnalytics (PGlite, seeded import-shaped data)", () => {
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
       values ($1::uuid, 'analytics-seed@example.test', 'not-a-real-hash')`,
      [USER_ID],
    );
    await pglite.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username)
       values ($1::uuid, $2::uuid, 'fixture_user', 'running', 'fixture_user')`,
      [JOB_ID, USER_ID],
    );
  });

  it("aggregates top artists, tracks, albums and recent tracks after canonicalization", async () => {
    const pool = pgliteAsPool(pglite);
    const insert = await batchInsertRawScrobbles(pool, {
      importJobId: JOB_ID,
      userId: USER_ID,
      rows: realisticLastfmImportRows(),
    });
    expect(insert.inserted).toBe(4);
    expect(insert.skippedDuplicates).toBe(0);

    const canon = await canonicalizePendingRawScrobblesBatch(pool, {
      importJobId: JOB_ID,
      userId: USER_ID,
      limit: 50,
    });
    expect(canon).toEqual({ examined: 4, succeeded: 4, failed: 0 });

    const summary = await getDashboardListenSummary(pool, {
      userId: USER_ID,
      range: "30d",
      topLimit: 10,
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    expect(summary.total_scrobbles).toBe(4);

    expect(summary.top_artists.map((a) => ({ name: a.name, plays: a.plays }))).toEqual([
      { name: "The National", plays: 3 },
      { name: "Radiohead", plays: 1 },
    ]);

    expect(
      summary.top_tracks.map((t) => ({
        title: t.title,
        artist_name: t.artist_name,
        plays: t.plays,
      })),
    ).toEqual([
      { title: "Demons", artist_name: "The National", plays: 2 },
      { title: "Paranoid Android", artist_name: "Radiohead", plays: 1 },
      { title: "Sea of Love", artist_name: "The National", plays: 1 },
    ]);

    expect(
      summary.top_albums.map((a) => ({
        title: a.title,
        artist_name: a.artist_name,
        plays: a.plays,
        musicbrainz_release_mbid: a.musicbrainz_release_mbid,
      })),
    ).toEqual([
      {
        title: "Trouble Will Find Me",
        artist_name: "The National",
        plays: 3,
        musicbrainz_release_mbid: "fake0000-0000-4000-8000-0000000000a1",
      },
      {
        title: "OK Computer",
        artist_name: "Radiohead",
        plays: 1,
        musicbrainz_release_mbid: "fake0000-0000-4000-8000-0000000000a2",
      },
    ]);

    expect(summary.top_tracks.map((t) => t.musicbrainz_release_mbid)).toEqual([
      "fake0000-0000-4000-8000-0000000000a1",
      "fake0000-0000-4000-8000-0000000000a2",
      "fake0000-0000-4000-8000-0000000000a1",
    ]);

    const recent = await getDashboardRecentListens(pool, {
      userId: USER_ID,
      range: "30d",
      limit: 10,
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    expect(recent.map((r) => r.track_title)).toEqual([
      "Paranoid Android",
      "Sea of Love",
      "Demons",
      "Demons",
    ]);
    expect(recent.map((r) => r.musicbrainz_release_mbid)).toEqual([
      "fake0000-0000-4000-8000-0000000000a2",
      "fake0000-0000-4000-8000-0000000000a1",
      "fake0000-0000-4000-8000-0000000000a1",
      "fake0000-0000-4000-8000-0000000000a1",
    ]);
  });

  it("uses album primary artist when track row artist name is only whitespace", async () => {
    const pool = pgliteAsPool(pglite);
    const blankArtistId = "10101010-1010-4010-8010-101010101010";
    const albumArtistId = "20202020-2020-4020-8020-202020202020";
    const albumId = "30303030-3030-4030-8030-303030303030";
    const trackId = "40404040-4040-4040-8040-404040404040";
    const listenId = "50505050-5050-4050-8050-505050505050";
    const recMbid = "60606060-6060-4060-8060-606060606060";

    await pglite.query(
      `insert into artists (id, name, musicbrainz_artist_mbid, name_key, updated_at)
       values ($1::uuid, '  ', 'dddddddd-dddd-4ddd-8ddd-dddddddd0001', 'blank', now())`,
      [blankArtistId],
    );
    await pglite.query(
      `insert into artists (id, name, musicbrainz_artist_mbid, name_key, updated_at)
       values ($1::uuid, 'Culture Club', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001', 'culture club', now())`,
      [albumArtistId],
    );
    await pglite.query(
      `insert into albums (id, artist_id, title, title_key, musicbrainz_release_mbid, updated_at)
       values ($1::uuid, $2::uuid, 'Colour by Numbers', 'colour by numbers', null, now())`,
      [albumId, albumArtistId],
    );
    await pglite.query(
      `insert into tracks (id, artist_id, album_id, title, title_key, musicbrainz_recording_mbid, updated_at)
       values ($1::uuid, $2::uuid, $3::uuid, 'Karma Chameleon', 'karma chameleon', $4::uuid, now())`,
      [trackId, blankArtistId, albumId, recMbid],
    );
    await pglite.query(
      `insert into listens (id, user_id, track_id, played_at, created_at)
       values ($1::uuid, $2::uuid, $3::uuid, now() - interval '1 minute', now())`,
      [listenId, USER_ID, trackId],
    );

    const recent = await getDashboardRecentListens(pool, {
      userId: USER_ID,
      range: "all",
      limit: 5,
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    expect(recent.some((r) => r.track_id === trackId && r.artist_name === "Culture Club")).toBe(
      true,
    );

    const summary = await getDashboardListenSummary(pool, {
      userId: USER_ID,
      range: "all",
      topLimit: 10,
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    const row = summary.top_tracks.find((t) => t.track_id === trackId);
    expect(row?.artist_name).toBe("Culture Club");
  });

  it("top albums use track artist when album owner row has no display name", async () => {
    const pool = pgliteAsPool(pglite);
    const blankAlbumOwnerId = "aa12aa12-aa12-4a12-8a12-aa12aa12aa12";
    const u2TrackArtistId = "bb12bb12-bb12-4b12-8b12-bb12bb12bb12";
    const albumId = "cc12cc12-cc12-4c12-8c12-cc12cc12cc12";
    const trackId = "dd12dd12-dd12-4d12-8d12-dd12dd12dd12";
    const listenId = "ee12ee12-ee12-4e12-8e12-ee12ee12ee12";

    await pglite.query(
      `insert into artists (id, name, musicbrainz_artist_mbid, name_key, updated_at)
       values ($1::uuid, '  ', null, 'blankalbowner12', now())`,
      [blankAlbumOwnerId],
    );
    await pglite.query(
      `insert into artists (id, name, musicbrainz_artist_mbid, name_key, updated_at)
       values ($1::uuid, 'U2', null, 'u2topalb12', now())`,
      [u2TrackArtistId],
    );
    await pglite.query(
      `insert into albums (id, artist_id, title, title_key, musicbrainz_release_mbid, updated_at)
       values ($1::uuid, $2::uuid, 'The Joshua Tree', 'the joshua tree', null, now())`,
      [albumId, blankAlbumOwnerId],
    );
    await pglite.query(
      `insert into tracks (id, artist_id, album_id, title, title_key, musicbrainz_recording_mbid, updated_at)
       values ($1::uuid, $2::uuid, $3::uuid, 'With or Without You', 'with or without you', null, now())`,
      [trackId, u2TrackArtistId, albumId],
    );
    await pglite.query(
      `insert into listens (id, user_id, track_id, played_at, created_at)
       values ($1::uuid, $2::uuid, $3::uuid, now() - interval '1 minute', now())`,
      [listenId, USER_ID, trackId],
    );

    const summary = await getDashboardListenSummary(pool, {
      userId: USER_ID,
      range: "all",
      topLimit: 10,
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    const topAl = summary.top_albums.find((a) => a.album_id === albumId);
    expect(topAl?.artist_name).toBe("U2");
  });

  it("top albums use raw release MBID for art when canonical album has no release MBID", async () => {
    const pool = pgliteAsPool(pglite);
    const artistId = "f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f2";
    const albumId = "f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f2";
    const trackId = "f3f3f3f3-f3f3-43f3-83f3-f3f3f3f3f3f2";
    const listenId = "f4f4f4f4-f4f4-44f4-84f4-f4f4f4f4f4f2";
    const rawId = "f5f5f5f5-f5f5-45f5-85f5-f5f5f5f5f5f2";
    const releaseMbidFromRaw = "a1b2c3d4-e5f6-4789-a012-3456789abcde";

    await pglite.query(
      `insert into artists (id, name, musicbrainz_artist_mbid, name_key, updated_at)
       values ($1::uuid, 'INXS', null, 'inxs top alb mbid', now())`,
      [artistId],
    );
    await pglite.query(
      `insert into albums (id, artist_id, title, title_key, musicbrainz_release_mbid, updated_at)
       values ($1::uuid, $2::uuid, 'Kick (2017 Remaster)', 'kick 2017 remaster', null, now())`,
      [albumId, artistId],
    );
    await pglite.query(
      `insert into tracks (id, artist_id, album_id, title, title_key, musicbrainz_recording_mbid, updated_at)
       values ($1::uuid, $2::uuid, $3::uuid, 'Need You Tonight', 'need you tonight', null, now())`,
      [trackId, artistId, albumId],
    );
    await pglite.query(
      `insert into raw_scrobbles (
         id, import_job_id, user_id, uts, played_at,
         artist_name, album_name, album_mbid, track_name,
         source_event_hash, canonicalization_status, raw_payload
       )
       values (
         $1::uuid, $2::uuid, $3::uuid, 1900000011, now() - interval '1 minute',
         'INXS', 'Kick (2017 Remaster)', $4::text, 'Need You Tonight',
         'raw_top_album_release_mbid_hash', 'succeeded', '{}'::jsonb
       )`,
      [rawId, JOB_ID, USER_ID, releaseMbidFromRaw],
    );
    await pglite.query(
      `insert into listens (id, user_id, track_id, played_at, raw_scrobble_id, created_at)
       values ($1::uuid, $2::uuid, $3::uuid, now(), $4::uuid, now())`,
      [listenId, USER_ID, trackId, rawId],
    );

    const summary = await getDashboardListenSummary(pool, {
      userId: USER_ID,
      range: "all",
      topLimit: 10,
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    const topAl = summary.top_albums.find((a) => a.album_id === albumId);
    expect(topAl?.musicbrainz_release_mbid).toBe(releaseMbidFromRaw.toLowerCase());
  });

  it("falls back to raw_scrobbles.artist_name when canonical artist names are empty", async () => {
    const pool = pgliteAsPool(pglite);
    const trackArtistId = "70707070-7070-4070-8070-707070707070";
    const albumArtistId = "80808080-8080-4080-8080-808080808080";
    const albumId = "90909090-9090-4090-8090-909090909090";
    const trackId = "a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0";
    const listenId = "b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0";
    const rawId = "c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0";
    const recMbid = "d0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0";

    await pglite.query(
      `insert into artists (id, name, musicbrainz_artist_mbid, name_key, updated_at)
       values ($1::uuid, '', 'f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1', 'tartist', now())`,
      [trackArtistId],
    );
    await pglite.query(
      `insert into artists (id, name, musicbrainz_artist_mbid, name_key, updated_at)
       values ($1::uuid, '', 'f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f2', 'aartist', now())`,
      [albumArtistId],
    );
    await pglite.query(
      `insert into albums (id, artist_id, title, title_key, musicbrainz_release_mbid, updated_at)
       values ($1::uuid, $2::uuid, 'LP', 'lp', null, now())`,
      [albumId, albumArtistId],
    );
    await pglite.query(
      `insert into tracks (id, artist_id, album_id, title, title_key, musicbrainz_recording_mbid, updated_at)
       values ($1::uuid, $2::uuid, $3::uuid, 'Karma Chameleon', 'karma chameleon', $4::uuid, now())`,
      [trackId, trackArtistId, albumId, recMbid],
    );
    await pglite.query(
      `insert into raw_scrobbles (
         id, import_job_id, user_id, uts, played_at,
         artist_name, track_name, source_event_hash,
         canonicalization_status, raw_payload
       )
       values (
         $1::uuid, $2::uuid, $3::uuid, 42424242, now() - interval '2 minutes',
         'Culture Club', 'Karma Chameleon', 'raw_fallback_demo_hash',
         'succeeded', '{}'::jsonb
       )`,
      [rawId, JOB_ID, USER_ID],
    );
    await pglite.query(
      `insert into listens (id, user_id, track_id, played_at, raw_scrobble_id, created_at)
       values ($1::uuid, $2::uuid, $3::uuid, now() - interval '1 minute', $4::uuid, now())`,
      [listenId, USER_ID, trackId, rawId],
    );

    const recent = await getDashboardRecentListens(pool, {
      userId: USER_ID,
      range: "all",
      limit: 5,
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    expect(recent.find((r) => r.listen_id === listenId)?.artist_name).toBe("Culture Club");

    const summary = await getDashboardListenSummary(pool, {
      userId: USER_ID,
      range: "all",
      topLimit: 10,
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    expect(summary.top_tracks.find((t) => t.track_id === trackId)?.artist_name).toBe(
      "Culture Club",
    );
    expect(summary.top_albums.find((a) => a.album_id === albumId)?.artist_name).toBe(
      "Culture Club",
    );
    expect(summary.top_artists.every((a) => a.name.trim().length > 0)).toBe(true);
    expect(summary.top_artists.some((a) => a.artist_id === trackArtistId)).toBe(false);
  });

  it("enriches recent listen album fields from raw_scrobbles when the track row has no album", async () => {
    const pool = pgliteAsPool(pglite);
    const artistId = "11111111-1111-4111-8111-111111111113";
    const trackId = "22222222-2222-4222-8222-222222222213";
    const listenId = "33333333-3333-4333-8333-333333333313";
    const rawId = "44444444-4444-4444-8444-444444444413";
    const recMbid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13";
    const relMbid = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbb13";

    await pglite.query(
      `insert into artists (id, name, musicbrainz_artist_mbid, name_key, updated_at)
       values ($1::uuid, 'U2', null, 'u2', now())`,
      [artistId],
    );
    await pglite.query(
      `insert into tracks (id, artist_id, album_id, title, title_key, musicbrainz_recording_mbid, updated_at)
       values ($1::uuid, $2::uuid, null, 'Where the Streets Have No Name', 'where the streets have no name', $3::text, now())`,
      [trackId, artistId, recMbid],
    );
    await pglite.query(
      `insert into raw_scrobbles (
         id, import_job_id, user_id, uts, played_at,
         artist_name, album_name, album_mbid, track_name, track_mbid,
         source_event_hash, canonicalization_status, raw_payload
       )
       values (
         $1::uuid, $2::uuid, $3::uuid, 1800000010, now() - interval '1 minute',
         'U2', 'The Joshua Tree', $4::text, 'Where the Streets Have No Name', $5::text,
         'raw_album_coalesce_demo_hash', 'succeeded', '{}'::jsonb
       )`,
      [rawId, JOB_ID, USER_ID, relMbid, recMbid],
    );
    await pglite.query(
      `insert into listens (id, user_id, track_id, played_at, raw_scrobble_id, created_at)
       values ($1::uuid, $2::uuid, $3::uuid, now(), $4::uuid, now())`,
      [listenId, USER_ID, trackId, rawId],
    );

    const recent = await getDashboardRecentListens(pool, {
      userId: USER_ID,
      range: "all",
      limit: 5,
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    const row = recent.find((r) => r.listen_id === listenId);
    expect(row?.album_title).toBe("The Joshua Tree");
    expect(row?.musicbrainz_release_mbid).toBe(relMbid.toLowerCase());
  });

  it("promotes album onto a recording-mbid track when a later scrobble carries release metadata", async () => {
    const pool = pgliteAsPool(pglite);
    const recordingMbid = "cccccccc-cccc-4ccc-8ccc-cccccccccc14";
    const releaseMbid = "dddddddd-dddd-4ddd-8ddd-dddddddddd14";

    const rows: RawImportListenRow[] = [
      {
        uts: 1_800_000_020n,
        playedAt: "2026-04-01T10:00:00.000Z",
        artistName: "U2",
        albumName: null,
        albumMbid: null,
        trackName: "Where the Streets Have No Name",
        artistMbid: null,
        trackMbid: recordingMbid,
        loved: false,
        rawPayload: {},
      },
      {
        uts: 1_800_000_120n,
        playedAt: "2026-04-01T11:00:00.000Z",
        artistName: "U2",
        albumName: "The Joshua Tree",
        albumMbid: releaseMbid,
        trackName: "Where the Streets Have No Name",
        artistMbid: null,
        trackMbid: recordingMbid,
        loved: false,
        rawPayload: {},
      },
    ];

    const insert = await batchInsertRawScrobbles(pool, {
      importJobId: JOB_ID,
      userId: USER_ID,
      rows,
    });
    expect(insert.inserted).toBe(2);

    const canon = await canonicalizePendingRawScrobblesBatch(pool, {
      importJobId: JOB_ID,
      userId: USER_ID,
      limit: 50,
    });
    expect(canon).toEqual({ examined: 2, succeeded: 2, failed: 0 });

    const { rows: tr } = await pglite.query<{ album_id: string | null }>(
      `select album_id from tracks where musicbrainz_recording_mbid = $1 limit 1`,
      [recordingMbid.toLowerCase()],
    );
    expect(tr[0]?.album_id).not.toBeNull();

    const recent = await getDashboardRecentListens(pool, {
      userId: USER_ID,
      range: "all",
      limit: 10,
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    const streets = recent.filter((r) => r.track_title === "Where the Streets Have No Name");
    expect(streets).toHaveLength(2);
    expect(streets.every((r) => r.album_title === "The Joshua Tree")).toBe(true);
    expect(streets.every((r) => r.musicbrainz_release_mbid === releaseMbid.toLowerCase())).toBe(
      true,
    );
  });

  it("applies time range so 7d excludes listens older than the cutoff", async () => {
    const pool = pgliteAsPool(pglite);
    await batchInsertRawScrobbles(pool, {
      importJobId: JOB_ID,
      userId: USER_ID,
      rows: realisticLastfmImportRows(),
    });
    await canonicalizePendingRawScrobblesBatch(pool, {
      importJobId: JOB_ID,
      userId: USER_ID,
      limit: 50,
    });

    const week = await getDashboardListenSummary(pool, {
      userId: USER_ID,
      range: "7d",
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    expect(week.total_scrobbles).toBe(3);

    const month = await getDashboardListenSummary(pool, {
      userId: USER_ID,
      range: "30d",
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    expect(month.total_scrobbles).toBe(4);

    const all = await getDashboardListenSummary(pool, {
      userId: USER_ID,
      range: "all",
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    expect(all.total_scrobbles).toBe(4);

    const recent7d = await getDashboardRecentListens(pool, {
      userId: USER_ID,
      range: "7d",
      limit: 20,
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    expect(recent7d).toHaveLength(3);
    const bound = playedAtLowerBoundUtc("7d", ANALYTICS_FIXTURE_NOW_MS)!;
    for (const r of recent7d) {
      expect(new Date(r.played_at).getTime()).toBeGreaterThanOrEqual(bound.getTime());
    }
  });

  it("does not inflate totals when batch insert skips duplicate source_event_hash rows", async () => {
    const pool = pgliteAsPool(pglite);
    const [a, b] = duplicateHashRows();
    const ins = await batchInsertRawScrobbles(pool, {
      importJobId: JOB_ID,
      userId: USER_ID,
      rows: [a, b],
    });
    expect(ins.inserted).toBe(1);
    expect(ins.skippedDuplicates).toBe(1);

    await canonicalizePendingRawScrobblesBatch(pool, {
      importJobId: JOB_ID,
      userId: USER_ID,
      limit: 50,
    });

    const summary = await getDashboardListenSummary(pool, {
      userId: USER_ID,
      range: "all",
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    expect(summary.total_scrobbles).toBe(1);
  });
});
