/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE imports RENAME TO import_jobs;

ALTER INDEX imports_user_id_idx RENAME TO import_jobs_user_id_idx;

ALTER TABLE import_jobs
  ADD COLUMN stage text NOT NULL DEFAULT 'idle'
    CONSTRAINT import_jobs_stage_check CHECK (
      stage IN ('idle', 'queued', 'running', 'succeeded', 'failed')
    ),
  ADD COLUMN error_message text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now ();

CREATE INDEX import_jobs_user_id_stage_idx ON import_jobs (user_id, stage);

CREATE TABLE artists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  name text NOT NULL,
  musicbrainz_artist_mbid text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX artists_name_idx ON artists (name);

CREATE INDEX artists_musicbrainz_artist_mbid_idx ON artists (musicbrainz_artist_mbid)
  WHERE musicbrainz_artist_mbid IS NOT NULL AND musicbrainz_artist_mbid <> '';

CREATE TABLE albums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  artist_id uuid NOT NULL REFERENCES artists (id) ON DELETE RESTRICT,
  title text NOT NULL,
  musicbrainz_release_mbid text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX albums_artist_id_idx ON albums (artist_id);

CREATE INDEX albums_title_idx ON albums (title);

CREATE TABLE tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  artist_id uuid NOT NULL REFERENCES artists (id) ON DELETE RESTRICT,
  album_id uuid REFERENCES albums (id) ON DELETE SET NULL,
  title text NOT NULL,
  musicbrainz_recording_mbid text,
  duration_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX tracks_artist_id_idx ON tracks (artist_id);

CREATE INDEX tracks_album_id_idx ON tracks (album_id);

CREATE INDEX tracks_title_idx ON tracks (title);

CREATE INDEX tracks_musicbrainz_recording_mbid_idx ON tracks (musicbrainz_recording_mbid)
  WHERE musicbrainz_recording_mbid IS NOT NULL AND musicbrainz_recording_mbid <> '';

CREATE TABLE raw_scrobbles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  import_job_id uuid NOT NULL REFERENCES import_jobs (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  uts bigint NOT NULL,
  played_at timestamptz NOT NULL,
  artist_name text NOT NULL,
  artist_mbid text,
  album_name text,
  album_mbid text,
  track_name text NOT NULL,
  track_mbid text,
  loved boolean NOT NULL DEFAULT false,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX raw_scrobbles_import_job_id_idx ON raw_scrobbles (import_job_id);

CREATE INDEX raw_scrobbles_user_id_played_at_idx ON raw_scrobbles (user_id, played_at);

CREATE UNIQUE INDEX raw_scrobbles_dedupe_uidx ON raw_scrobbles (
  user_id,
  uts,
  artist_name,
  track_name
);

CREATE TABLE listens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES tracks (id) ON DELETE RESTRICT,
  played_at timestamptz NOT NULL,
  import_job_id uuid REFERENCES import_jobs (id) ON DELETE SET NULL,
  raw_scrobble_id uuid REFERENCES raw_scrobbles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now (),
  CONSTRAINT listens_raw_scrobble_id_key UNIQUE (raw_scrobble_id)
);

CREATE INDEX listens_user_id_played_at_idx ON listens (user_id, played_at);

CREATE INDEX listens_track_id_idx ON listens (track_id);

CREATE INDEX listens_import_job_id_idx ON listens (import_job_id)
  WHERE import_job_id IS NOT NULL;

CREATE UNIQUE INDEX listens_user_track_played_at_uidx ON listens (user_id, track_id, played_at);
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS listens_user_track_played_at_uidx;

DROP INDEX IF EXISTS listens_import_job_id_idx;

DROP INDEX IF EXISTS listens_track_id_idx;

DROP INDEX IF EXISTS listens_user_id_played_at_idx;

DROP TABLE IF EXISTS listens;

DROP INDEX IF EXISTS raw_scrobbles_dedupe_uidx;

DROP INDEX IF EXISTS raw_scrobbles_user_id_played_at_idx;

DROP INDEX IF EXISTS raw_scrobbles_import_job_id_idx;

DROP TABLE IF EXISTS raw_scrobbles;

DROP INDEX IF EXISTS tracks_musicbrainz_recording_mbid_idx;

DROP INDEX IF EXISTS tracks_title_idx;

DROP INDEX IF EXISTS tracks_album_id_idx;

DROP INDEX IF EXISTS tracks_artist_id_idx;

DROP TABLE IF EXISTS tracks;

DROP INDEX IF EXISTS albums_title_idx;

DROP INDEX IF EXISTS albums_artist_id_idx;

DROP TABLE IF EXISTS albums;

DROP INDEX IF EXISTS artists_musicbrainz_artist_mbid_idx;

DROP INDEX IF EXISTS artists_name_idx;

DROP TABLE IF EXISTS artists;

DROP INDEX IF EXISTS import_jobs_user_id_stage_idx;

ALTER TABLE import_jobs
  DROP CONSTRAINT IF EXISTS import_jobs_stage_check,
  DROP COLUMN IF EXISTS stage,
  DROP COLUMN IF EXISTS error_message,
  DROP COLUMN IF EXISTS updated_at;

ALTER INDEX import_jobs_user_id_idx RENAME TO imports_user_id_idx;

ALTER TABLE import_jobs RENAME TO imports;
  `);
};
