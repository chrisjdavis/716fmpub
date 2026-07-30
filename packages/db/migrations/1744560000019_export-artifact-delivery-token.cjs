/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE export_jobs
  ADD COLUMN artifact_delivery_token text;

UPDATE export_jobs
SET artifact_delivery_token =
      md5(random()::text || clock_timestamp()::text || id::text)
      || md5(random()::text || clock_timestamp()::text || id::text || 'b')
WHERE stage = 'completed'
  AND artifact_relative_path IS NOT NULL
  AND artifact_delivery_token IS NULL;

ALTER TABLE export_jobs
  ADD CONSTRAINT export_jobs_completed_requires_delivery_token CHECK (
    (stage <> 'completed')
    OR (artifact_relative_path IS NULL)
    OR (
      artifact_delivery_token IS NOT NULL
      AND length(trim(artifact_delivery_token)) >= 32
    )
  );
`);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
ALTER TABLE export_jobs
  DROP CONSTRAINT IF EXISTS export_jobs_completed_requires_delivery_token;

ALTER TABLE export_jobs
  DROP COLUMN IF EXISTS artifact_delivery_token;
`);
};
