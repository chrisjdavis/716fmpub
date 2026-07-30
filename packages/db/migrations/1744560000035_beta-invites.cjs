/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
CREATE TABLE beta_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  token_hash text NOT NULL,
  locked_email text NULL,
  max_uses integer NOT NULL,
  used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NULL,
  revoked_at timestamptz NULL,
  revoked_reason text NULL,
  created_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  CONSTRAINT beta_invites_token_hash_key UNIQUE (token_hash),
  CONSTRAINT beta_invites_max_uses_chk CHECK (max_uses >= 1),
  CONSTRAINT beta_invites_used_count_chk CHECK (used_count >= 0 AND used_count <= max_uses)
);

CREATE INDEX beta_invites_created_by_user_id_idx
  ON beta_invites (created_by_user_id);

CREATE INDEX beta_invites_revoked_at_idx
  ON beta_invites (revoked_at);

CREATE INDEX beta_invites_expires_at_idx
  ON beta_invites (expires_at);

CREATE TABLE beta_invite_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  invite_id uuid NOT NULL REFERENCES beta_invites (id) ON DELETE CASCADE,
  redeemed_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  redeemed_at timestamptz NOT NULL DEFAULT now (),
  CONSTRAINT beta_invite_redemptions_invite_user_key UNIQUE (invite_id, redeemed_user_id)
);

CREATE INDEX beta_invite_redemptions_invite_id_idx
  ON beta_invite_redemptions (invite_id);

CREATE INDEX beta_invite_redemptions_redeemed_user_id_idx
  ON beta_invite_redemptions (redeemed_user_id);
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS beta_invite_redemptions_redeemed_user_id_idx;

DROP INDEX IF EXISTS beta_invite_redemptions_invite_id_idx;

DROP TABLE IF EXISTS beta_invite_redemptions;

DROP INDEX IF EXISTS beta_invites_expires_at_idx;

DROP INDEX IF EXISTS beta_invites_revoked_at_idx;

DROP INDEX IF EXISTS beta_invites_created_by_user_id_idx;

DROP TABLE IF EXISTS beta_invites;
  `);
};
