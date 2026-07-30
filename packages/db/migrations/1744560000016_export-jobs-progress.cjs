/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE export_jobs
  ADD COLUMN items_processed integer NOT NULL DEFAULT 0,
  ADD COLUMN items_total integer;

ALTER TABLE export_jobs
  ADD CONSTRAINT export_jobs_items_processed_nonnegative CHECK (items_processed >= 0);

ALTER TABLE export_jobs
  ADD CONSTRAINT export_jobs_items_total_nonnegative CHECK (items_total IS NULL OR items_total >= 0);
`);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
ALTER TABLE export_jobs
  DROP CONSTRAINT IF EXISTS export_jobs_items_total_nonnegative;

ALTER TABLE export_jobs
  DROP CONSTRAINT IF EXISTS export_jobs_items_processed_nonnegative;

ALTER TABLE export_jobs
  DROP COLUMN IF EXISTS items_total,
  DROP COLUMN IF EXISTS items_processed;
`);
};
