/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
-- Billing / entitlements tier (716FM). Distinct from staff privilege (account_role) and lifecycle (account_status).
ALTER TABLE users
  ADD COLUMN product_plan text NOT NULL DEFAULT 'core';

ALTER TABLE users
  ADD CONSTRAINT users_product_plan_chk CHECK (
    product_plan IN ('core', 'advanced')
  );
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_product_plan_chk;

ALTER TABLE users
  DROP COLUMN IF EXISTS product_plan;
  `);
};
