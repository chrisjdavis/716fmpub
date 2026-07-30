/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE sessions
  ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_rotated_at timestamptz NOT NULL DEFAULT now();

UPDATE sessions
SET
  last_seen_at = created_at,
  last_rotated_at = created_at;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
ALTER TABLE sessions
  DROP COLUMN IF EXISTS last_rotated_at,
  DROP COLUMN IF EXISTS last_seen_at;
  `);
};
