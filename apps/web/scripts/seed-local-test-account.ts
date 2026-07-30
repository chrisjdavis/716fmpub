import { countUsers, getPool } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { summarizeThrowableForLog } from "@vs/sensitive";
import {
  LOCAL_TEST_ACCOUNT_EMAIL,
  localTestAccountPassword,
} from "../src/dev/local-test-account";
import { hashPassword } from "../src/server/auth/password";

async function main(): Promise<void> {
  const env = loadServerEnv();
  if (env.deployEnv === "production" || env.deployEnv === "staging") {
    console.error(
      "seed-local-test-account: refusing to run when deploy environment is production or staging",
    );
    process.exit(1);
  }

  const pool = getPool(env);
  const email = LOCAL_TEST_ACCOUNT_EMAIL;
  const password = localTestAccountPassword(env);
  const passwordHash = await hashPassword(password);

  const existingCount = await countUsers(pool);
  if (existingCount > 0) {
    const { rows: match } = await pool.query<{ id: string }>(
      `select id from users where email = $1 limit 1`,
      [email],
    );
    if (!match[0]) {
      console.error(
        "seed-local-test-account: refusing to create a second user (instance already has an owner with a different email). Delete the existing user or seed with that email.",
      );
      process.exit(1);
    }
  }

  const { rows } = await pool.query<{ id: string }>(
    `insert into users (email, password_hash, email_verified_at, account_role, product_plan)
     values ($1, $2, now(), 'owner', 'advanced')
     on conflict (email) do update
       set password_hash = excluded.password_hash,
           email_verified_at = now(),
           account_role = 'owner',
           product_plan = 'advanced',
           updated_at = now()
     returning id`,
    [email, passwordHash],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("seed upsert returned no row");
  }

  console.log(
    `seed-local-test-account: upserted user id=${row.id} email=${email}`,
  );
  console.log(
    "seed-local-test-account: set VS_LOCAL_SEED_PASSWORD in .env to change the password from the default.",
  );
}

main().catch((err: unknown) => {
  console.error("seed-local-test-account: fatal", summarizeThrowableForLog(err));
  process.exit(1);
});
