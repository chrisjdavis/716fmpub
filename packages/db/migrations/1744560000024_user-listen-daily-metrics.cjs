/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
CREATE TABLE user_listen_daily_metrics (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  calendar_day date NOT NULL,
  play_count integer NOT NULL,
  distinct_tracks integer NOT NULL,
  distinct_artists integer NOT NULL,
  distinct_albums integer NOT NULL,
  top_artist_id uuid REFERENCES artists (id) ON DELETE SET NULL,
  top_artist_plays integer,
  top_track_id uuid REFERENCES tracks (id) ON DELETE SET NULL,
  top_track_plays integer,
  first_listen_at timestamptz,
  last_listen_at timestamptz,
  peak_hour_bucket smallint,
  computed_at timestamptz NOT NULL DEFAULT now (),
  PRIMARY KEY (user_id, calendar_day)
);

CREATE INDEX user_listen_daily_metrics_user_computed_idx
  ON user_listen_daily_metrics (user_id, computed_at DESC);

COMMENT ON TABLE user_listen_daily_metrics IS
  'Per-user local-calendar-day rollups using users.stats_timezone (see statsRollupTimeZone).';
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS user_listen_daily_metrics_user_computed_idx;
DROP TABLE IF EXISTS user_listen_daily_metrics;
  `);
};
