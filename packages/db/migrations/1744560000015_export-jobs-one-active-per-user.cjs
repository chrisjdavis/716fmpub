/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
CREATE UNIQUE INDEX export_jobs_user_one_active_stage_uidx
ON export_jobs (user_id)
WHERE stage IN ('queued', 'running');
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
DROP INDEX IF EXISTS export_jobs_user_one_active_stage_uidx;
  `);
};
