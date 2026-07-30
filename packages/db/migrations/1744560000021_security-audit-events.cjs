/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
CREATE TABLE security_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  occurred_at timestamptz NOT NULL DEFAULT now (),
  actor_user_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT security_audit_events_action_check CHECK (action IN (
    'auth.login',
    'auth.logout',
    'export.generate',
    'account.settings_patch',
    'import.trigger',
    'listen_data.deletion_attempt',
    'listen_data.deletion_complete'
  )),
  CONSTRAINT security_audit_events_outcome_check CHECK (outcome IN ('success', 'failure', 'denied'))
);

CREATE INDEX security_audit_events_actor_time_idx
  ON security_audit_events (actor_user_id, occurred_at DESC);

CREATE INDEX security_audit_events_time_idx
  ON security_audit_events (occurred_at DESC);
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS security_audit_events_time_idx;
DROP INDEX IF EXISTS security_audit_events_actor_time_idx;
DROP TABLE IF EXISTS security_audit_events;
  `);
};
