/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
ALTER TABLE security_audit_events
  DROP CONSTRAINT IF EXISTS security_audit_events_action_check;

ALTER TABLE security_audit_events
  ADD CONSTRAINT security_audit_events_action_check CHECK (action IN (
    'auth.login',
    'auth.logout',
    'export.generate',
    'account.settings_patch',
    'account.email_change_request',
    'account.email_change_complete',
    'import.trigger',
    'listen_data.deletion_attempt',
    'listen_data.deletion_complete',
    'onboarding.lastfm_configure',
    'onboarding.lastfm_validate',
    'onboarding.defer',
    'onboarding.complete',
    'onboarding.import_start'
  ));
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
ALTER TABLE security_audit_events
  DROP CONSTRAINT IF EXISTS security_audit_events_action_check;

ALTER TABLE security_audit_events
  ADD CONSTRAINT security_audit_events_action_check CHECK (action IN (
    'auth.login',
    'auth.logout',
    'export.generate',
    'account.settings_patch',
    'import.trigger',
    'listen_data.deletion_attempt',
    'listen_data.deletion_complete'
  ));
  `);
};
