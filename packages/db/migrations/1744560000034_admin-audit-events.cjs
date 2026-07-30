/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
-- Staff/admin accountability: who changed what, on which entity, with optional structured context.
-- Distinct from security_audit_events (user security posture + outcomes). Extend actions via new migrations.
CREATE TABLE admin_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  occurred_at timestamptz NOT NULL DEFAULT now (),
  actor_user_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT admin_audit_events_action_check CHECK (action IN (
    'admin.invite.created',
    'admin.invite.revoked',
    'admin.invite.accepted',
    'admin.user.account_role_changed',
    'admin.user.account_status_changed'
  )),
  CONSTRAINT admin_audit_events_target_type_check CHECK (target_type IN ('user', 'invite'))
);

CREATE INDEX admin_audit_events_actor_time_idx
  ON admin_audit_events (actor_user_id, occurred_at DESC);

CREATE INDEX admin_audit_events_target_time_idx
  ON admin_audit_events (target_type, target_id, occurred_at DESC);

CREATE INDEX admin_audit_events_time_idx
  ON admin_audit_events (occurred_at DESC);
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS admin_audit_events_time_idx;
DROP INDEX IF EXISTS admin_audit_events_target_time_idx;
DROP INDEX IF EXISTS admin_audit_events_actor_time_idx;
DROP TABLE IF EXISTS admin_audit_events;
  `);
};
