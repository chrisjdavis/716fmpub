import { computeSourceEventHash } from "@vs/domain";
import type { Pool, PoolClient, QueryResultRow } from "pg";

/**
 * Normalized listen row from a source fetch (e.g. Last.fm `LastfmImportListenEvent`).
 * Kept local to `@vs/db` so this package does not depend on `@vs/lastfm-provider`.
 */
export type RawImportListenRow = Readonly<{
  uts: bigint;
  /** ISO 8601 instant (UTC), stored as `played_at`. */
  playedAt: string;
  artistName: string;
  albumName: string | null;
  trackName: string;
  artistMbid: string | null;
  albumMbid: string | null;
  trackMbid: string | null;
  loved: boolean;
  rawPayload: Readonly<Record<string, unknown>>;
}>;

export type RawScrobbleBatchInsertResult = Readonly<{
  /** Rows successfully inserted in this call (excludes conflicts). */
  inserted: number;
  /** Rows skipped because `(user_id, source_event_hash)` already exists. */
  skippedDuplicates: number;
}>;

export type RawScrobbleDbExecutor =
  | Pick<Pool, "query">
  | Pick<PoolClient, "query">;

const MAX_UNNEST_BATCH = 500;

function mapRowCount(row: QueryResultRow | undefined): number {
  if (!row) {
    return 0;
  }
  const v = row["row_count"];
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  return 0;
}

/**
 * Inserts many `raw_scrobbles` for one import job using a single statement per chunk.
 * Idempotent per `(user_id, source_event_hash)` via `ON CONFLICT DO NOTHING`.
 */
export async function batchInsertRawScrobbles(
  db: RawScrobbleDbExecutor,
  input: Readonly<{
    importJobId: string;
    userId: string;
    rows: readonly RawImportListenRow[];
  }>,
): Promise<RawScrobbleBatchInsertResult> {
  const { importJobId, userId, rows } = input;
  if (rows.length === 0) {
    return { inserted: 0, skippedDuplicates: 0 };
  }

  let inserted = 0;
  let skippedDuplicates = 0;

  for (let offset = 0; offset < rows.length; offset += MAX_UNNEST_BATCH) {
    const chunk = rows.slice(offset, offset + MAX_UNNEST_BATCH);
    const n = chunk.length;

    const importJobIds = Array.from({ length: n }, () => importJobId);
    const userIds = Array.from({ length: n }, () => userId);
    const utsList: string[] = [];
    const playedAts: string[] = [];
    const artistNames: string[] = [];
    const artistMbids: (string | null)[] = [];
    const albumNames: (string | null)[] = [];
    const albumMbids: (string | null)[] = [];
    const trackNames: string[] = [];
    const trackMbids: (string | null)[] = [];
    const loveds: boolean[] = [];
    const hashes: string[] = [];
    const payloadJsonTexts: string[] = [];

    for (const r of chunk) {
      utsList.push(r.uts.toString());
      playedAts.push(r.playedAt);
      artistNames.push(r.artistName);
      artistMbids.push(r.artistMbid);
      albumNames.push(r.albumName);
      albumMbids.push(r.albumMbid);
      trackNames.push(r.trackName);
      trackMbids.push(r.trackMbid);
      loveds.push(r.loved);
      hashes.push(
        computeSourceEventHash({
          uts: r.uts,
          artistName: r.artistName,
          trackName: r.trackName,
          albumName: r.albumName,
          artistMbid: r.artistMbid,
          albumMbid: r.albumMbid,
          trackMbid: r.trackMbid,
          loved: r.loved,
        }),
      );
      payloadJsonTexts.push(JSON.stringify(r.rawPayload));
    }

    const { rows: outRows } = await db.query<{ row_count: string | number }>(
      `with data as (
         select
           import_job_id,
           user_id,
           uts,
           played_at,
           artist_name,
           artist_mbid,
           album_name,
           album_mbid,
           track_name,
           track_mbid,
           loved,
           source_event_hash,
           raw_payload_json::jsonb as raw_payload
         from unnest(
           $1::uuid[],
           $2::uuid[],
           $3::bigint[],
           $4::timestamptz[],
           $5::text[],
           $6::text[],
           $7::text[],
           $8::text[],
           $9::text[],
           $10::text[],
           $11::boolean[],
           $12::text[],
           $13::text[]
         ) as t(
           import_job_id,
           user_id,
           uts,
           played_at,
           artist_name,
           artist_mbid,
           album_name,
           album_mbid,
           track_name,
           track_mbid,
           loved,
           source_event_hash,
           raw_payload_json
         )
       ),
       ins as (
         insert into raw_scrobbles (
           import_job_id,
           user_id,
           uts,
           played_at,
           artist_name,
           artist_mbid,
           album_name,
           album_mbid,
           track_name,
           track_mbid,
           loved,
           source_event_hash,
           raw_payload
         )
         select
           import_job_id,
           user_id,
           uts,
           played_at,
           artist_name,
           artist_mbid,
           album_name,
           album_mbid,
           track_name,
           track_mbid,
           loved,
           source_event_hash,
           raw_payload
         from data
         on conflict (user_id, source_event_hash) do nothing
         returning 1
       )
       select (select count(*)::bigint from ins) as row_count`,
      [
        importJobIds,
        userIds,
        utsList,
        playedAts,
        artistNames,
        artistMbids,
        albumNames,
        albumMbids,
        trackNames,
        trackMbids,
        loveds,
        hashes,
        payloadJsonTexts,
      ],
    );

    const chunkInserted = mapRowCount(outRows[0]);
    inserted += chunkInserted;
    skippedDuplicates += n - chunkInserted;
  }

  return { inserted, skippedDuplicates };
}
