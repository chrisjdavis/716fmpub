/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
-- Admin authorization foundations: explicit role tier and account lifecycle status.
-- Defaults + backfill keep existing rows on the ordinary user path until operators promote accounts.
ALTER TABLE users
  ADD COLUMN account_role text NOT NULL DEFAULT 'user',
  ADD COLUMN account_status text NOT NULL DEFAULT 'active';

ALTER TABLE users
  ADD CONSTRAINT users_account_role_chk CHECK (
    account_role IN ('user', 'admin', 'owner')
  );

ALTER TABLE users
  ADD CONSTRAINT users_account_status_chk CHECK (
    account_status IN ('active', 'disabled', 'suspended')
  );

CREATE INDEX users_account_role_idx ON users (account_role);

CREATE INDEX users_account_status_idx ON users (account_status);
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS users_account_status_idx;

DROP INDEX IF EXISTS users_account_role_idx;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_account_status_chk;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_account_role_chk;

ALTER TABLE users
  DROP COLUMN IF EXISTS account_status,
  DROP COLUMN IF EXISTS account_role;
  `);
};
