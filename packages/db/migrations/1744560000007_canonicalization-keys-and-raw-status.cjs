/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE raw_scrobbles
  ADD COLUMN canonicalization_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN canonicalization_error text;

ALTER TABLE raw_scrobbles
  ADD CONSTRAINT raw_scrobbles_canonicalization_status_check CHECK (
    canonicalization_status IN ('pending', 'succeeded', 'failed')
  );

CREATE INDEX raw_scrobbles_import_job_canonicalization_idx ON raw_scrobbles (
  import_job_id,
  canonicalization_status
);

ALTER TABLE artists
  ADD COLUMN name_key text;

UPDATE artists
SET
  name_key = lower(regexp_replace(trim(name), '[[:space:]]+', ' ', 'g'))
WHERE name_key IS NULL;

ALTER TABLE artists
  ALTER COLUMN name_key SET NOT NULL;

DROP INDEX IF EXISTS artists_musicbrainz_artist_mbid_idx;

CREATE UNIQUE INDEX artists_musicbrainz_artist_mbid_uidx ON artists (musicbrainz_artist_mbid)
  WHERE musicbrainz_artist_mbid IS NOT NULL AND btrim(musicbrainz_artist_mbid) <> '';

CREATE UNIQUE INDEX artists_name_key_no_mbid_uidx ON artists (name_key)
  WHERE musicbrainz_artist_mbid IS NULL OR btrim(musicbrainz_artist_mbid) = '';

ALTER TABLE albums
  ADD COLUMN title_key text;

UPDATE albums
SET
  title_key = lower(regexp_replace(trim(title), '[[:space:]]+', ' ', 'g'))
WHERE title_key IS NULL;

ALTER TABLE albums
  ALTER COLUMN title_key SET NOT NULL;

CREATE UNIQUE INDEX albums_musicbrainz_release_mbid_uidx ON albums (musicbrainz_release_mbid)
  WHERE musicbrainz_release_mbid IS NOT NULL AND btrim(musicbrainz_release_mbid) <> '';

CREATE UNIQUE INDEX albums_artist_title_key_no_mbid_uidx ON albums (artist_id, title_key)
  WHERE musicbrainz_release_mbid IS NULL OR btrim(musicbrainz_release_mbid) = '';

ALTER TABLE tracks
  ADD COLUMN title_key text;

UPDATE tracks
SET
  title_key = lower(regexp_replace(trim(title), '[[:space:]]+', ' ', 'g'))
WHERE title_key IS NULL;

ALTER TABLE tracks
  ALTER COLUMN title_key SET NOT NULL;

CREATE UNIQUE INDEX tracks_musicbrainz_recording_mbid_uidx ON tracks (musicbrainz_recording_mbid)
  WHERE musicbrainz_recording_mbid IS NOT NULL AND btrim(musicbrainz_recording_mbid) <> '';

CREATE UNIQUE INDEX tracks_artist_album_title_key_no_mbid_uidx ON tracks (
  artist_id,
  coalesce(album_id, '00000000-0000-0000-0000-000000000000'::uuid),
  title_key
)
  WHERE musicbrainz_recording_mbid IS NULL OR btrim(musicbrainz_recording_mbid) = '';
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS tracks_artist_album_title_key_no_mbid_uidx;

DROP INDEX IF EXISTS tracks_musicbrainz_recording_mbid_uidx;

ALTER TABLE tracks
  DROP COLUMN IF EXISTS title_key;

CREATE INDEX tracks_musicbrainz_recording_mbid_idx ON tracks (musicbrainz_recording_mbid)
  WHERE musicbrainz_recording_mbid IS NOT NULL AND musicbrainz_recording_mbid <> '';

DROP INDEX IF EXISTS albums_artist_title_key_no_mbid_uidx;

DROP INDEX IF EXISTS albums_musicbrainz_release_mbid_uidx;

ALTER TABLE albums
  DROP COLUMN IF EXISTS title_key;

DROP INDEX IF EXISTS artists_name_key_no_mbid_uidx;

DROP INDEX IF EXISTS artists_musicbrainz_artist_mbid_uidx;

ALTER TABLE artists
  DROP COLUMN IF EXISTS name_key;

CREATE INDEX artists_musicbrainz_artist_mbid_idx ON artists (musicbrainz_artist_mbid)
  WHERE musicbrainz_artist_mbid IS NOT NULL AND musicbrainz_artist_mbid <> '';

DROP INDEX IF EXISTS raw_scrobbles_import_job_canonicalization_idx;

ALTER TABLE raw_scrobbles
  DROP CONSTRAINT IF EXISTS raw_scrobbles_canonicalization_status_check;

ALTER TABLE raw_scrobbles
  DROP COLUMN IF EXISTS canonicalization_error,
  DROP COLUMN IF EXISTS canonicalization_status;
  `);
};
