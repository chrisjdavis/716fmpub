import { normalizeImportMbid, normalizeImportString } from "@vs/domain";
import type { Pool, PoolClient } from "pg";

export type RawScrobbleCanonicalizationStatus = "pending" | "succeeded" | "failed";

export type CanonicalizePendingBatchResult = Readonly<{
  /** Rows locked and examined in this batch (same as succeeded + failed). */
  examined: number;
  succeeded: number;
  failed: number;
}>;

export type CanonicalizeDbExecutor = Pick<Pool, "connect">;

const NIL_ALBUM_UUID = "00000000-0000-0000-0000-000000000000";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

function truncateErr(msg: string, max = 2000): string {
  if (msg.length <= max) {
    return msg;
  }
  return `${msg.slice(0, max - 24)} [error truncated]`;
}

async function markRawOutcome(
  client: PoolClient,
  input: Readonly<{
    rawId: string;
    status: RawScrobbleCanonicalizationStatus;
    error: string | null;
  }>,
): Promise<void> {
  const succeeded = input.status === "succeeded";
  await client.query(
    `update raw_scrobbles
     set
       canonicalization_status = $2::text,
       canonicalization_error = $3,
       processed_at = case when $4::boolean then now() else processed_at end
     where id = $1::uuid`,
    [input.rawId, input.status, input.error, succeeded],
  );
}

async function resolveArtistId(
  client: PoolClient,
  artistName: string,
  artistMbidRaw: string | null,
): Promise<string> {
  const nameKey = normalizeImportString(artistName);
  const mbid = normalizeImportMbid(artistMbidRaw);
  if (mbid) {
    const hit = await client.query<{ id: string }>(
      `select id from artists where musicbrainz_artist_mbid = $1 limit 1`,
      [mbid],
    );
    if (hit.rows[0]) {
      return hit.rows[0].id;
    }
    try {
      const ins = await client.query<{ id: string }>(
        `insert into artists (name, musicbrainz_artist_mbid, name_key, updated_at)
         values ($1, $2, $3, now())
         returning id`,
        [artistName, mbid, nameKey],
      );
      const row = ins.rows[0];
      if (!row) {
        throw new Error("resolveArtistId: insert with mbid returned no row");
      }
      return row.id;
    } catch (err) {
      if (isUniqueViolation(err)) {
        const again = await client.query<{ id: string }>(
          `select id from artists where musicbrainz_artist_mbid = $1 limit 1`,
          [mbid],
        );
        const found = again.rows[0];
        if (found) {
          return found.id;
        }
      }
      throw err;
    }
  }

  const miss = await client.query<{ id: string }>(
    `select id from artists
     where (musicbrainz_artist_mbid is null or btrim(musicbrainz_artist_mbid) = '')
       and name_key = $1
     limit 1`,
    [nameKey],
  );
  if (miss.rows[0]) {
    return miss.rows[0].id;
  }
  try {
    const ins = await client.query<{ id: string }>(
      `insert into artists (name, musicbrainz_artist_mbid, name_key, updated_at)
       values ($1, null, $2, now())
       returning id`,
      [artistName, nameKey],
    );
    const row = ins.rows[0];
    if (!row) {
      throw new Error("resolveArtistId: insert without mbid returned no row");
    }
    return row.id;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const again = await client.query<{ id: string }>(
        `select id from artists
         where (musicbrainz_artist_mbid is null or btrim(musicbrainz_artist_mbid) = '')
           and name_key = $1
         limit 1`,
        [nameKey],
      );
      const found = again.rows[0];
      if (found) {
        return found.id;
      }
    }
    throw err;
  }
}

type ResolvedAlbumForTrack = Readonly<{
  albumId: string | null;
  /**
   * Artist to attach the track to. When a release MBID matches an existing album, this is always
   * that album's `artist_id` so the row stays consistent with MusicBrainz even if Last.fm credited
   * a different artist (featuring name, remixer, etc.).
   */
  artistId: string;
}>;

async function resolveAlbumForTrack(
  client: PoolClient,
  input: Readonly<{
    artistId: string;
    albumName: string | null;
    albumMbidRaw: string | null;
  }>,
): Promise<ResolvedAlbumForTrack> {
  const mbid = normalizeImportMbid(input.albumMbidRaw);
  const titleKey = normalizeImportString(input.albumName ?? "");
  if (mbid) {
    const hit = await client.query<{ id: string; artist_id: string }>(
      `select id, artist_id from albums where musicbrainz_release_mbid = $1 limit 1`,
      [mbid],
    );
    const row0 = hit.rows[0];
    if (row0) {
      return { albumId: row0.id, artistId: row0.artist_id };
    }
    const displayTitle = (input.albumName ?? "").trim() === "" ? "(unknown album)" : String(input.albumName);
    try {
      const ins = await client.query<{ id: string }>(
        `insert into albums (artist_id, title, musicbrainz_release_mbid, title_key, updated_at)
         values ($1::uuid, $2, $3, $4, now())
         returning id`,
        [input.artistId, displayTitle, mbid, normalizeImportString(displayTitle)],
      );
      const row = ins.rows[0];
      if (!row) {
        throw new Error("resolveAlbumForTrack: insert with mbid returned no row");
      }
      return { albumId: row.id, artistId: input.artistId };
    } catch (err) {
      if (isUniqueViolation(err)) {
        const again = await client.query<{ id: string; artist_id: string }>(
          `select id, artist_id from albums where musicbrainz_release_mbid = $1 limit 1`,
          [mbid],
        );
        const ag = again.rows[0];
        if (ag) {
          return { albumId: ag.id, artistId: ag.artist_id };
        }
      }
      throw err;
    }
  }
  if (titleKey === "") {
    return { albumId: null, artistId: input.artistId };
  }
  const miss = await client.query<{ id: string }>(
    `select id from albums
     where artist_id = $1::uuid
       and (musicbrainz_release_mbid is null or btrim(musicbrainz_release_mbid) = '')
       and title_key = $2
     limit 1`,
    [input.artistId, titleKey],
  );
  if (miss.rows[0]) {
    return { albumId: miss.rows[0].id, artistId: input.artistId };
  }
  const displayTitle = String(input.albumName).trim();
  try {
    const ins = await client.query<{ id: string }>(
      `insert into albums (artist_id, title, musicbrainz_release_mbid, title_key, updated_at)
       values ($1::uuid, $2, null, $3, now())
       returning id`,
      [input.artistId, displayTitle, titleKey],
    );
    const row = ins.rows[0];
    if (!row) {
      throw new Error("resolveAlbumForTrack: insert without mbid returned no row");
    }
    return { albumId: row.id, artistId: input.artistId };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const again = await client.query<{ id: string }>(
        `select id from albums
         where artist_id = $1::uuid
           and (musicbrainz_release_mbid is null or btrim(musicbrainz_release_mbid) = '')
           and title_key = $2
         limit 1`,
        [input.artistId, titleKey],
      );
      if (again.rows[0]) {
        return { albumId: again.rows[0].id, artistId: input.artistId };
      }
    }
    throw err;
  }
}

/**
 * When Last.fm first attached a recording MBID without album metadata, we still create/find the
 * track by MBID alone. A later scrobble may include release MBID or album title; apply it to the
 * shared track row so every listen benefits (dashboard no longer shows the same recording split
 * between “has album / art” and blank rows).
 */
async function promoteRecordingMbidTrackIfAlbumEnrichmentAvailable(
  client: PoolClient,
  input: Readonly<{
    trackId: string;
    artistName: string;
    artistMbid: string | null;
    albumName: string | null;
    albumMbid: string | null;
  }>,
): Promise<void> {
  const rawAlbumMbid = normalizeImportMbid(input.albumMbid);
  const rawAlbumTitleKey = normalizeImportString(input.albumName ?? "");
  if (rawAlbumMbid === null && rawAlbumTitleKey === "") {
    return;
  }

  const cur = await client.query<{
    album_id: string | null;
    current_release_mbid: string | null;
  }>(
    `select t.album_id, a.musicbrainz_release_mbid as current_release_mbid
     from tracks t
     left join albums a on a.id = t.album_id
     where t.id = $1::uuid`,
    [input.trackId],
  );
  const curRow = cur.rows[0];
  if (!curRow) {
    return;
  }

  const artistIdFromRaw = await resolveArtistId(client, input.artistName, input.artistMbid);
  const { albumId, artistId } = await resolveAlbumForTrack(client, {
    artistId: artistIdFromRaw,
    albumName: input.albumName,
    albumMbidRaw: input.albumMbid,
  });
  if (!albumId) {
    return;
  }

  const { rows: resAlbumRows } = await client.query<{ musicbrainz_release_mbid: string | null }>(
    `select musicbrainz_release_mbid from albums where id = $1::uuid limit 1`,
    [albumId],
  );
  const resolvedReleaseMbid = normalizeImportMbid(resAlbumRows[0]?.musicbrainz_release_mbid ?? null);
  const currentReleaseMbid = normalizeImportMbid(curRow.current_release_mbid);

  const shouldPromote =
    curRow.album_id === null ||
    (currentReleaseMbid === null && resolvedReleaseMbid !== null);

  if (!shouldPromote) {
    return;
  }

  await client.query(
    `update tracks set artist_id = $2::uuid, album_id = $3::uuid, updated_at = now() where id = $1::uuid`,
    [input.trackId, artistId, albumId],
  );
}

async function resolveTrackId(
  client: PoolClient,
  input: Readonly<{
    artistName: string;
    artistMbid: string | null;
    albumName: string | null;
    albumMbid: string | null;
    trackName: string;
    trackMbid: string | null;
  }>,
): Promise<string> {
  const trackMbid = normalizeImportMbid(input.trackMbid);
  if (trackMbid) {
    const byRec = await client.query<{ id: string }>(
      `select id from tracks where musicbrainz_recording_mbid = $1 limit 1`,
      [trackMbid],
    );
    if (byRec.rows[0]) {
      const id = byRec.rows[0].id;
      await promoteRecordingMbidTrackIfAlbumEnrichmentAvailable(client, {
        trackId: id,
        artistName: input.artistName,
        artistMbid: input.artistMbid,
        albumName: input.albumName,
        albumMbid: input.albumMbid,
      });
      return id;
    }
  }

  const artistIdFromRaw = await resolveArtistId(client, input.artistName, input.artistMbid);
  const { albumId, artistId } = await resolveAlbumForTrack(client, {
    artistId: artistIdFromRaw,
    albumName: input.albumName,
    albumMbidRaw: input.albumMbid,
  });
  const titleKey = normalizeImportString(input.trackName);
  const albumKeySql = albumId ?? NIL_ALBUM_UUID;

  if (!trackMbid) {
    const miss = await client.query<{ id: string }>(
      `select id from tracks
       where artist_id = $1::uuid
         and coalesce(album_id, $2::uuid) = $3::uuid
         and (musicbrainz_recording_mbid is null or btrim(musicbrainz_recording_mbid) = '')
         and title_key = $4
       limit 1`,
      [artistId, NIL_ALBUM_UUID, albumKeySql, titleKey],
    );
    if (miss.rows[0]) {
      return miss.rows[0].id;
    }
  }

  try {
    const ins = await client.query<{ id: string }>(
      `insert into tracks (
         artist_id,
         album_id,
         title,
         musicbrainz_recording_mbid,
         title_key,
         updated_at
       )
       values ($1::uuid, $2::uuid, $3, $4, $5, now())
       returning id`,
      [
        artistId,
        albumId,
        input.trackName,
        trackMbid,
        titleKey,
      ],
    );
    const row = ins.rows[0];
    if (!row) {
      throw new Error("resolveTrackId: insert returned no row");
    }
    return row.id;
  } catch (err) {
    if (isUniqueViolation(err) && !trackMbid) {
      const again = await client.query<{ id: string }>(
        `select id from tracks
         where artist_id = $1::uuid
           and coalesce(album_id, $2::uuid) = $3::uuid
           and (musicbrainz_recording_mbid is null or btrim(musicbrainz_recording_mbid) = '')
           and title_key = $4
         limit 1`,
        [artistId, NIL_ALBUM_UUID, albumKeySql, titleKey],
      );
      if (again.rows[0]) {
        return again.rows[0].id;
      }
    }
    if (isUniqueViolation(err) && trackMbid) {
      const again = await client.query<{ id: string }>(
        `select id from tracks where musicbrainz_recording_mbid = $1 limit 1`,
        [trackMbid],
      );
      if (again.rows[0]) {
        return again.rows[0].id;
      }
    }
    throw err;
  }
}

type PendingRow = Readonly<{
  id: string;
  user_id: string;
  import_job_id: string;
  played_at: string;
  artist_name: string;
  artist_mbid: string | null;
  album_name: string | null;
  album_mbid: string | null;
  track_name: string;
  track_mbid: string | null;
}>;

async function processOneRawRow(client: PoolClient, row: PendingRow): Promise<void> {
  const trackId = await resolveTrackId(client, {
    artistName: row.artist_name,
    artistMbid: row.artist_mbid,
    albumName: row.album_name,
    albumMbid: row.album_mbid,
    trackName: row.track_name,
    trackMbid: row.track_mbid,
  });

  const inserted = await client.query<{ id: string }>(
    `insert into listens (user_id, track_id, played_at, import_job_id, raw_scrobble_id)
     values ($1::uuid, $2::uuid, $3::timestamptz, $4::uuid, $5::uuid)
     on conflict do nothing
     returning id`,
    [row.user_id, trackId, row.played_at, row.import_job_id, row.id],
  );

  if (!inserted.rows[0]) {
    await markRawOutcome(client, {
      rawId: row.id,
      status: "failed",
      error:
        "unique_violation_on_listen: duplicate user_id+track_id+played_at or raw_scrobble_id prevents attaching this raw row",
    });
    return;
  }

  await markRawOutcome(client, {
    rawId: row.id,
    status: "succeeded",
    error: null,
  });
}

/**
 * Locks and canonicalizes up to `limit` pending `raw_scrobbles` for a single import job.
 * MBID matches win when present; otherwise normalized-name keys (`normalizeImportString`) apply.
 * When a release MBID matches an existing album, track rows use that album's `artist_id` even if
 * Last.fm credited a different artist on the raw scrobble.
 * Each succeeded row gets a `listens` row and `canonicalization_status = 'succeeded'` plus `processed_at`.
 *
 * **Job contract:** The Last.fm worker records row-level failures on `raw_scrobbles`.
 * If at least one listen canonicalizes successfully, the import can still complete
 * with a warning in `import_jobs.error_message`; if no usable rows remain, the job fails.
 */
export async function canonicalizePendingRawScrobblesBatch(
  db: CanonicalizeDbExecutor,
  input: Readonly<{
    importJobId: string;
    userId: string;
    /** Max raw rows per transaction batch. */
    limit?: number;
  }>,
): Promise<CanonicalizePendingBatchResult> {
  const limit = input.limit ?? 500;
  const client = await db.connect();
  let examined = 0;
  let succeeded = 0;
  let failed = 0;
  let transactionOpen = false;
  try {
    await client.query("begin");
    transactionOpen = true;
    const { rows } = await client.query<PendingRow>(
      `select
         id,
         user_id,
         import_job_id,
         played_at::text,
         artist_name,
         artist_mbid,
         album_name,
         album_mbid,
         track_name,
         track_mbid
       from raw_scrobbles
       where import_job_id = $1::uuid
         and user_id = $2::uuid
         and canonicalization_status = 'pending'
       order by played_at asc, id asc
       limit $3
       for update skip locked`,
      [input.importJobId, input.userId, limit],
    );

    for (const row of rows) {
      examined += 1;
      try {
        await processOneRawRow(client, row);
        const st = await client.query<{ canonicalization_status: string }>(
          `select canonicalization_status from raw_scrobbles where id = $1::uuid`,
          [row.id],
        );
        const status = st.rows[0]?.canonicalization_status;
        if (status === "failed") {
          failed += 1;
        } else {
          succeeded += 1;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await markRawOutcome(client, {
          rawId: row.id,
          status: "failed",
          error: truncateErr(`canonicalization_error: ${msg}`),
        });
        failed += 1;
      }
    }

    await client.query("commit");
    transactionOpen = false;
  } catch (err) {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        /* ignore rollback errors */
      }
    }
    throw err;
  } finally {
    client.release();
  }

  return { examined, succeeded, failed };
}
