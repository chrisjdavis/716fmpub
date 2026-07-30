/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
CREATE TABLE email_verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now (),
  CONSTRAINT email_verification_tokens_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX email_verification_tokens_user_unconsumed_idx
  ON email_verification_tokens (user_id)
  WHERE consumed_at IS NULL;
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS email_verification_tokens_user_unconsumed_idx;

DROP TABLE IF EXISTS email_verification_tokens;
  `);
};
