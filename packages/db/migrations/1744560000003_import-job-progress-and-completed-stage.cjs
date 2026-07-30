/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE import_jobs
  ADD COLUMN items_total integer,
  ADD COLUMN items_processed integer NOT NULL DEFAULT 0;

ALTER TABLE import_jobs
  ADD CONSTRAINT import_jobs_items_processed_nonnegative CHECK (items_processed >= 0);

ALTER TABLE import_jobs
  ADD CONSTRAINT import_jobs_items_total_nonnegative CHECK (items_total IS NULL OR items_total >= 0);

UPDATE import_jobs SET stage = 'completed' WHERE stage = 'succeeded';

ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_stage_check;

ALTER TABLE import_jobs
  ADD CONSTRAINT import_jobs_stage_check CHECK (
    stage IN ('idle', 'queued', 'running', 'completed', 'failed')
  );

ALTER TABLE import_jobs ALTER COLUMN stage SET DEFAULT 'queued';
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
ALTER TABLE import_jobs ALTER COLUMN stage SET DEFAULT 'idle';

ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_stage_check;

UPDATE import_jobs SET stage = 'succeeded' WHERE stage = 'completed';

ALTER TABLE import_jobs
  ADD CONSTRAINT import_jobs_stage_check CHECK (
    stage IN ('idle', 'queued', 'running', 'succeeded', 'failed')
  );

ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_items_total_nonnegative;

ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_items_processed_nonnegative;

ALTER TABLE import_jobs
  DROP COLUMN IF EXISTS items_processed,
  DROP COLUMN IF EXISTS items_total;
  `);
};
