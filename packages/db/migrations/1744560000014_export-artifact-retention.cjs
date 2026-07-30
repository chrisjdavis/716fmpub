/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE export_jobs
  ADD COLUMN artifact_expires_at timestamptz;

ALTER TABLE export_jobs
  DROP CONSTRAINT export_jobs_stage_check;

ALTER TABLE export_jobs
  ADD CONSTRAINT export_jobs_stage_check CHECK (
    stage IN ('queued', 'running', 'completed', 'failed', 'expired')
  );

UPDATE export_jobs
SET artifact_expires_at = updated_at + interval '7 days'
WHERE stage = 'completed'
  AND artifact_relative_path IS NOT NULL
  AND artifact_expires_at IS NULL;

ALTER TABLE export_jobs
  ADD CONSTRAINT export_jobs_completed_requires_expiry CHECK (
    (stage <> 'completed')
    OR (artifact_relative_path IS NULL)
    OR (artifact_expires_at IS NOT NULL)
  );

CREATE INDEX export_jobs_listen_export_cleanup_idx
  ON export_jobs (artifact_expires_at ASC)
  WHERE stage = 'completed'
    AND artifact_relative_path IS NOT NULL
    AND artifact_expires_at IS NOT NULL;
`);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS export_jobs_listen_export_cleanup_idx;

ALTER TABLE export_jobs
  DROP CONSTRAINT IF EXISTS export_jobs_completed_requires_expiry;

UPDATE export_jobs
SET
  stage = 'failed',
  error_message = CASE
    WHEN trim(coalesce(error_message, '')) = '' THEN 'Export expired (rolled back migration).'
    ELSE error_message
  END
WHERE stage = 'expired';

ALTER TABLE export_jobs
  DROP CONSTRAINT export_jobs_stage_check;

ALTER TABLE export_jobs
  ADD CONSTRAINT export_jobs_stage_check CHECK (
    stage IN ('queued', 'running', 'completed', 'failed')
  );

ALTER TABLE export_jobs
  DROP COLUMN IF EXISTS artifact_expires_at;
`);
};
