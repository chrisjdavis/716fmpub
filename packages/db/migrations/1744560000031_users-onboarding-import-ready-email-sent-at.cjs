/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE users
  ADD COLUMN onboarding_import_ready_email_sent_at timestamptz NULL;

COMMENT ON COLUMN users.onboarding_import_ready_email_sent_at IS
  'When we sent the one-shot "import and stats processing finished" email for guided onboarding.';
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
ALTER TABLE users
  DROP COLUMN IF EXISTS onboarding_import_ready_email_sent_at;
  `);
};
