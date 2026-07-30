/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
-- VS-74 — durable per-user Layer 1 recompute lifecycle (additive; does not touch evidence tables).
CREATE TABLE layer1_user_recompute_state (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  status text NOT NULL,
  signal_version text NOT NULL,
  input_watermark timestamptz NULL,
  last_enqueued_at timestamptz NULL,
  last_started_at timestamptz NULL,
  last_succeeded_at timestamptz NULL,
  last_failed_at timestamptz NULL,
  failure_code text NULL,
  failure_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  CONSTRAINT layer1_user_recompute_state_status_check CHECK (status IN (
    'never_computed',
    'queued',
    'running',
    'fresh',
    'stale',
    'failed'
  )),
  CONSTRAINT layer1_user_recompute_state_signal_version_len CHECK (
    char_length (signal_version) >= 1 AND char_length (signal_version) <= 256
  ),
  CONSTRAINT layer1_user_recompute_state_failure_code_len CHECK (
    failure_code IS NULL OR (char_length (failure_code) >= 1 AND char_length (failure_code) <= 128)
  ),
  CONSTRAINT layer1_user_recompute_state_failure_message_len CHECK (
    failure_message IS NULL OR char_length (failure_message) <= 4000
  ),
  CONSTRAINT layer1_user_recompute_state_failed_fields_chk CHECK (
    (status <> 'failed')
    OR (last_failed_at IS NOT NULL AND failure_code IS NOT NULL)
  )
);

CREATE INDEX layer1_user_recompute_state_status_updated_idx
  ON layer1_user_recompute_state (status, updated_at DESC);
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS layer1_user_recompute_state_status_updated_idx;
DROP TABLE IF EXISTS layer1_user_recompute_state;
  `);
};
