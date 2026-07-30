/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE users
  ADD COLUMN signup_beta_invite_id uuid NULL REFERENCES beta_invites (id) ON DELETE SET NULL;

COMMENT ON COLUMN users.signup_beta_invite_id IS
  'Invite used at account creation (nullable for accounts created before invite gating).';

CREATE INDEX users_signup_beta_invite_id_idx
  ON users (signup_beta_invite_id)
  WHERE signup_beta_invite_id IS NOT NULL;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS users_signup_beta_invite_id_idx;

ALTER TABLE users
  DROP COLUMN IF EXISTS signup_beta_invite_id;
  `);
};
