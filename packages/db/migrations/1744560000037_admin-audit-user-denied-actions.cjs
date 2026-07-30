/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE admin_audit_events
  DROP CONSTRAINT IF EXISTS admin_audit_events_action_check;

ALTER TABLE admin_audit_events
  ADD CONSTRAINT admin_audit_events_action_check CHECK (action IN (
    'admin.invite.created',
    'admin.invite.revoked',
    'admin.invite.accepted',
    'admin.user.account_role_changed',
    'admin.user.account_status_changed',
    'admin.user.account_role_change_denied',
    'admin.user.account_status_change_denied'
  ));
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DELETE FROM admin_audit_events
 WHERE action IN (
    'admin.user.account_role_change_denied',
    'admin.user.account_status_change_denied'
  );

ALTER TABLE admin_audit_events
  DROP CONSTRAINT IF EXISTS admin_audit_events_action_check;

ALTER TABLE admin_audit_events
  ADD CONSTRAINT admin_audit_events_action_check CHECK (action IN (
    'admin.invite.created',
    'admin.invite.revoked',
    'admin.invite.accepted',
    'admin.user.account_role_changed',
    'admin.user.account_status_changed'
  ));
  `);
};
