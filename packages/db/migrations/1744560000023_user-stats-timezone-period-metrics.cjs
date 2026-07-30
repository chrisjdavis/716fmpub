/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE users
  ADD COLUMN stats_timezone text;

COMMENT ON COLUMN users.stats_timezone IS
  'IANA zone for stats day boundaries (e.g. America/New_York). NULL = infer from request (e.g. Vercel header) or UTC.';

CREATE TABLE user_listen_period_metrics (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  period_kind text NOT NULL CHECK (period_kind IN ('calendar_week', 'calendar_month', 'calendar_year')),
  period_start date NOT NULL,
  play_count integer NOT NULL,
  unique_track_count integer NOT NULL,
  unique_artist_count integer NOT NULL,
  unique_album_count integer NOT NULL,
  top_artist_id uuid REFERENCES artists (id) ON DELETE SET NULL,
  top_artist_name text,
  top_artist_plays integer,
  top_track_id uuid REFERENCES tracks (id) ON DELETE SET NULL,
  top_track_title text,
  top_track_plays integer,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period_kind, period_start)
);

CREATE INDEX user_listen_period_metrics_user_kind_idx
  ON user_listen_period_metrics (user_id, period_kind);

CREATE TABLE user_artist_listen_stats (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  artist_id uuid NOT NULL REFERENCES artists (id) ON DELETE CASCADE,
  first_played_at timestamptz NOT NULL,
  last_played_at timestamptz NOT NULL,
  play_count bigint NOT NULL,
  PRIMARY KEY (user_id, artist_id)
);

CREATE INDEX user_artist_listen_stats_user_last_idx
  ON user_artist_listen_stats (user_id, last_played_at DESC);
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS user_artist_listen_stats_user_last_idx;
DROP TABLE IF EXISTS user_artist_listen_stats;

DROP INDEX IF EXISTS user_listen_period_metrics_user_kind_idx;
DROP TABLE IF EXISTS user_listen_period_metrics;

ALTER TABLE users DROP COLUMN IF EXISTS stats_timezone;
  `);
};
