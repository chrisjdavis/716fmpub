/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
CREATE INDEX listens_user_id_played_at_id_desc_idx
  ON listens (user_id, played_at DESC, id DESC);

DROP INDEX IF EXISTS listens_user_id_played_at_idx;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
CREATE INDEX listens_user_id_played_at_idx ON listens (user_id, played_at);

DROP INDEX IF EXISTS listens_user_id_played_at_id_desc_idx;
  `);
};
