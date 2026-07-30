/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE import_jobs
  ADD COLUMN lastfm_username text;

UPDATE import_jobs
SET lastfm_username = trim(label)
WHERE lastfm_username IS NULL;

ALTER TABLE import_jobs
  ALTER COLUMN lastfm_username SET NOT NULL;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
ALTER TABLE import_jobs
  DROP COLUMN IF EXISTS lastfm_username;
  `);
};
