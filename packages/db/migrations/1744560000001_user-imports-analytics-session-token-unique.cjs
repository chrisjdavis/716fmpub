/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE sessions
  ADD CONSTRAINT sessions_token_hash_key UNIQUE (token_hash);

CREATE TABLE imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX imports_user_id_idx ON imports (user_id);

CREATE TABLE analytics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now (),
  UNIQUE (user_id, kind)
);

CREATE INDEX analytics_snapshots_user_id_idx ON analytics_snapshots (user_id);
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS analytics_snapshots_user_id_idx;

DROP TABLE IF EXISTS analytics_snapshots;

DROP INDEX IF EXISTS imports_user_id_idx;

DROP TABLE IF EXISTS imports;

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_token_hash_key;
  `);
};
