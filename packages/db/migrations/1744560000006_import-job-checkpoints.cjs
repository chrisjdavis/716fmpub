/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE import_jobs
  ADD COLUMN checkpoint_pages_completed integer NOT NULL DEFAULT 0,
  ADD COLUMN checkpoint_oldest_uts bigint;

ALTER TABLE import_jobs
  ADD CONSTRAINT import_jobs_checkpoint_pages_completed_nonnegative CHECK (checkpoint_pages_completed >= 0);
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_checkpoint_pages_completed_nonnegative;

ALTER TABLE import_jobs
  DROP COLUMN IF EXISTS checkpoint_oldest_uts,
  DROP COLUMN IF EXISTS checkpoint_pages_completed;
  `);
};
