/**
 * Seeds three VS-54 listening-history profiles into the configured Postgres database.
 * Refuses production (and staging, matching other local seed scripts).
 */
import { getPool } from "../src/index.js";
import { loadServerEnv } from "@vs/env";
import { summarizeThrowableForLog } from "@vs/sensitive";
import {
  SIGNAL_VALIDATION_PROFILE_IDS,
  SIGNAL_VALIDATION_STATS_TIMEZONE_IANA,
  batchInsertRawImportListenRowsThenCanonicalize,
  signalValidationSeedImportJobId,
  signalValidationSeedUserId,
} from "../src/test/signalValidationListenSeeds.js";

const PLACEHOLDER_PASSWORD_HASH =
  "$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31My" as const;

function seedEmail(profile: string): string {
  return `vs54+${profile}@seed.716fm.test`;
}

async function main(): Promise<void> {
  const env = loadServerEnv();
  if (env.deployEnv === "production" || env.deployEnv === "staging") {
    console.error(
      "seed-signal-validation-profiles: refusing to run when deploy environment is production or staging",
    );
    process.exit(1);
  }

  const pool = getPool(env);

  for (const profileId of SIGNAL_VALIDATION_PROFILE_IDS) {
    const userId = signalValidationSeedUserId(profileId);
    const jobId = signalValidationSeedImportJobId(profileId);
    const email = seedEmail(profileId);

    await pool.query(`delete from users where id = $1::uuid`, [userId]);

    await pool.query(
      `insert into users (id, email, password_hash, stats_timezone, email_verified_at)
       values ($1::uuid, $2, $3, $4, now())`,
      [userId, email, PLACEHOLDER_PASSWORD_HASH, SIGNAL_VALIDATION_STATS_TIMEZONE_IANA],
    );

    await pool.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username)
       values ($1::uuid, $2::uuid, 'vs54_signal_validation', 'running', 'fixture_user')`,
      [jobId, userId],
    );

    const out = await batchInsertRawImportListenRowsThenCanonicalize(pool, {
      userId,
      importJobId: jobId,
      profileId,
    });

    console.log(
      `seed-signal-validation-profiles: profile=${profileId} user=${userId} email=${email} listens=${out.canonicalized.succeeded}/${out.rowCount}`,
    );
  }

  console.log(
    "seed-signal-validation-profiles: done (password is a shared placeholder; do not use for real accounts)",
  );
}

main().catch((err: unknown) => {
  console.error("seed-signal-validation-profiles: fatal", summarizeThrowableForLog(err));
  process.exit(1);
});
