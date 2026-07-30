/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
UPDATE users
   SET email_verified_at = created_at
 WHERE email_verified_at IS NULL;
`);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (_pgm) => {
  /* Data backfill is not safely reversible without losing legitimate verification timestamps. */
};
