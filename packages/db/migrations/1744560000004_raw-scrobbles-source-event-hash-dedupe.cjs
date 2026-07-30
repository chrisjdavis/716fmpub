/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
-- Pre-VS-8 rows had no source_event_hash; the new contract is hash-based dedupe per user.
DELETE FROM raw_scrobbles;

DROP INDEX IF EXISTS raw_scrobbles_dedupe_uidx;

ALTER TABLE raw_scrobbles
  ADD COLUMN source_event_hash text NOT NULL;

CREATE UNIQUE INDEX raw_scrobbles_user_id_source_event_hash_uidx ON raw_scrobbles (
  user_id,
  source_event_hash
);
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS raw_scrobbles_user_id_source_event_hash_uidx;

ALTER TABLE raw_scrobbles
  DROP COLUMN IF EXISTS source_event_hash;

CREATE UNIQUE INDEX raw_scrobbles_dedupe_uidx ON raw_scrobbles (
  user_id,
  uts,
  artist_name,
  track_name
);
  `);
};
