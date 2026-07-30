/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE users
  ADD COLUMN welcome_email_sent_at timestamptz NULL;

COMMENT ON COLUMN users.welcome_email_sent_at IS
  'Set when a welcome email dispatch is reserved or successfully completed; cleared on send failure before provider acceptance so a retry remains possible.';
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
ALTER TABLE users
  DROP COLUMN IF EXISTS welcome_email_sent_at;
  `);
};
