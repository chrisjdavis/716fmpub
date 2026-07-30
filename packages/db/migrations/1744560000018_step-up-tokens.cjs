/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
CREATE TABLE step_up_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  purpose text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now (),
  CONSTRAINT step_up_tokens_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX step_up_tokens_user_purpose_unconsumed_idx
  ON step_up_tokens (user_id, purpose)
  WHERE consumed_at IS NULL;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS step_up_tokens_user_purpose_unconsumed_idx;

DROP TABLE IF EXISTS step_up_tokens;
  `);
};
