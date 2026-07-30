/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE users
  ADD COLUMN email_verified_at timestamptz NULL;

COMMENT ON COLUMN users.email_verified_at IS
  'When the account email was confirmed via email verification; NULL means unverified.';
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
ALTER TABLE users
  DROP COLUMN IF EXISTS email_verified_at;
  `);
};
