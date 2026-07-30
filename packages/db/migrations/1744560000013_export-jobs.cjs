/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
CREATE TABLE export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  format text NOT NULL
    CONSTRAINT export_jobs_format_check CHECK (format IN ('json', 'csv')),
  stage text NOT NULL DEFAULT 'queued'
    CONSTRAINT export_jobs_stage_check CHECK (
      stage IN ('queued', 'running', 'completed', 'failed')
    ),
  artifact_relative_path text,
  error_message text,
  bullmq_job_id text,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX export_jobs_user_id_created_at_idx ON export_jobs (user_id, created_at DESC);

CREATE INDEX export_jobs_stage_idx ON export_jobs (stage)
  WHERE stage IN ('queued', 'running');
`);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP TABLE IF EXISTS export_jobs;
`);
};
