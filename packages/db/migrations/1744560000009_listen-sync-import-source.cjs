/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE import_jobs
  ADD COLUMN source text NOT NULL DEFAULT 'user'
    CONSTRAINT import_jobs_source_check CHECK (source IN ('user', 'system_sync'));

ALTER TABLE users
  ADD COLUMN last_listen_sync_attempt_at timestamptz NULL;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
ALTER TABLE users
  DROP COLUMN IF EXISTS last_listen_sync_attempt_at;

ALTER TABLE import_jobs
  DROP CONSTRAINT IF EXISTS import_jobs_source_check;

ALTER TABLE import_jobs
  DROP COLUMN IF EXISTS source;
  `);
};
