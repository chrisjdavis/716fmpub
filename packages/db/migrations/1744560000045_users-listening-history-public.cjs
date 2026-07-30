/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE users
  ADD COLUMN listening_history_public boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.listening_history_public IS
  'When true, Explore and Archive may be viewed without a session on this single-user instance.';
`);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
ALTER TABLE users
  DROP COLUMN IF EXISTS listening_history_public;
`);
};
