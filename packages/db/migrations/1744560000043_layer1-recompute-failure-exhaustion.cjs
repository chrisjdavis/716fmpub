/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE layer1_user_recompute_state
  ADD COLUMN IF NOT EXISTS consecutive_failure_count integer NOT NULL DEFAULT 0;

ALTER TABLE layer1_user_recompute_state
  DROP CONSTRAINT IF EXISTS layer1_user_recompute_state_status_check;

ALTER TABLE layer1_user_recompute_state
  ADD CONSTRAINT layer1_user_recompute_state_status_check CHECK (status IN (
    'never_computed',
    'queued',
    'running',
    'fresh',
    'stale',
    'failed',
    'failed_exhausted'
  ));

ALTER TABLE layer1_user_recompute_state
  DROP CONSTRAINT IF EXISTS layer1_user_recompute_state_failed_fields_chk;

ALTER TABLE layer1_user_recompute_state
  ADD CONSTRAINT layer1_user_recompute_state_failed_fields_chk CHECK (
    (status NOT IN ('failed', 'failed_exhausted'))
    OR (last_failed_at IS NOT NULL AND failure_code IS NOT NULL)
  );

ALTER TABLE layer1_user_recompute_state
  ADD CONSTRAINT layer1_user_recompute_state_consecutive_failure_count_chk CHECK (
    consecutive_failure_count >= 0 AND consecutive_failure_count <= 10000
  );
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
UPDATE layer1_user_recompute_state
   SET status = 'failed'
 WHERE status = 'failed_exhausted';

ALTER TABLE layer1_user_recompute_state
  DROP CONSTRAINT IF EXISTS layer1_user_recompute_state_consecutive_failure_count_chk;

ALTER TABLE layer1_user_recompute_state
  DROP CONSTRAINT IF EXISTS layer1_user_recompute_state_failed_fields_chk;

ALTER TABLE layer1_user_recompute_state
  ADD CONSTRAINT layer1_user_recompute_state_failed_fields_chk CHECK (
    (status <> 'failed')
    OR (last_failed_at IS NOT NULL AND failure_code IS NOT NULL)
  );

ALTER TABLE layer1_user_recompute_state
  DROP CONSTRAINT IF EXISTS layer1_user_recompute_state_status_check;

ALTER TABLE layer1_user_recompute_state
  ADD CONSTRAINT layer1_user_recompute_state_status_check CHECK (status IN (
    'never_computed',
    'queued',
    'running',
    'fresh',
    'stale',
    'failed'
  ));

ALTER TABLE layer1_user_recompute_state
  DROP COLUMN IF EXISTS consecutive_failure_count;
  `);
};
