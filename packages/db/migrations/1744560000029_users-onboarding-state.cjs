/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
-- Guided onboarding: durable progress, deferral, and completion timestamps.
-- Backfill: users who already finished a user-sourced import or have canonical listens
-- are treated as onboarded so existing accounts are not forced through the wizard.
ALTER TABLE users
  ADD COLUMN onboarding_state text NOT NULL DEFAULT 'not_started',
  ADD COLUMN onboarding_dismissed_at timestamptz,
  ADD COLUMN onboarding_completed_at timestamptz,
  ADD COLUMN onboarding_context_json jsonb,
  ADD COLUMN onboarding_deferred_at timestamptz;

ALTER TABLE users
  ADD CONSTRAINT users_onboarding_state_chk CHECK (
    onboarding_state IN (
      'not_started',
      'intro',
      'connect_source',
      'configure_lastfm',
      'validating_lastfm',
      'ready_to_import',
      'import_started',
      'import_in_progress',
      'partial_ready',
      'completed'
    )
  );

UPDATE users u
SET
  onboarding_state = 'completed',
  onboarding_completed_at = now()
WHERE
  EXISTS (
    SELECT 1
    FROM import_jobs ij
    WHERE ij.user_id = u.id
      AND ij.source = 'user'
      AND ij.stage = 'completed'
  )
  OR EXISTS (
    SELECT 1
    FROM listens l
    WHERE l.user_id = u.id
  );
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_onboarding_state_chk;

ALTER TABLE users
  DROP COLUMN IF EXISTS onboarding_deferred_at,
  DROP COLUMN IF EXISTS onboarding_context_json,
  DROP COLUMN IF EXISTS onboarding_completed_at,
  DROP COLUMN IF EXISTS onboarding_dismissed_at,
  DROP COLUMN IF EXISTS onboarding_state;
  `);
};
