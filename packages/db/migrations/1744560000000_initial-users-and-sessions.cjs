/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS sessions_expires_at_idx;

DROP INDEX IF EXISTS sessions_user_id_idx;

DROP TABLE IF EXISTS sessions;

DROP TABLE IF EXISTS users;
  `);
};
