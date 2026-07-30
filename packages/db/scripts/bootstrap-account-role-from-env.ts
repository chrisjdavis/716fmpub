import pg from "pg";

import { loadServerEnv } from "@vs/env";
import { summarizeThrowableForLog } from "@vs/sensitive";

import {
  applyBootstrapAccountRole,
  readBootstrapAccountRoleEnv,
} from "../src/bootstrapAccountRole.js";

async function main(): Promise<void> {
  const env = loadServerEnv();
  if (env.deployEnv === "production") {
    console.error(
      "bootstrap-account-role-from-env: refusing to run when deploy environment is production. Apply role changes through your controlled release process (SQL migration window or audited DBA session).",
    );
    process.exit(1);
  }

  const { email, targetRole, rawTarget } = readBootstrapAccountRoleEnv();
  if (!email) {
    console.error(
      "bootstrap-account-role-from-env: VS_BOOTSTRAP_ACCOUNT_ROLE_EMAIL is unset; nothing to do.",
    );
    process.exit(0);
  }
  if (targetRole === null) {
    console.error(
      `bootstrap-account-role-from-env: invalid VS_BOOTSTRAP_ACCOUNT_ROLE=${JSON.stringify(rawTarget)} (use owner or admin)`,
    );
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const result = await applyBootstrapAccountRole(client, { email, targetRole });
    if (!result.ok) {
      if (result.error === "user_not_found") {
        console.error(
          `bootstrap-account-role-from-env: no user row for canonical email=${result.email}`,
        );
        process.exit(1);
      }
      if (result.error === "account_not_active") {
        console.error(
          `bootstrap-account-role-from-env: account_status is not active for email=${result.email}; re-activate the row before promoting roles.`,
        );
        process.exit(1);
      }
      console.error(`bootstrap-account-role-from-env: ${result.error}`);
      process.exit(1);
    }
    if ("skipped" in result && result.skipped) {
      process.exit(0);
    }
    const action = result.didUpdate ? "updated" : "already satisfied";
    console.error(
      `bootstrap-account-role-from-env: ${action} user_id=${result.userId} role ${result.previousRole} -> ${result.newRole}`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((err: unknown) => {
  console.error(
    "bootstrap-account-role-from-env: fatal",
    summarizeThrowableForLog(err),
  );
  process.exit(1);
});
