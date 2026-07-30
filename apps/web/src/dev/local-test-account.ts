import type { ServerEnv } from "@vs/env";

/**
 * Defaults for the local-only seed + smoke workflow (`npm run seed:local`, `npm run smoke:local`).
 * Override the password with `VS_LOCAL_SEED_PASSWORD` in `.env` when rotating credentials.
 */
export const LOCAL_TEST_ACCOUNT_EMAIL = "dev@local.test" as const;

export function localTestAccountPassword(
  env: Pick<ServerEnv, "deployEnv" | "VS_LOCAL_SEED_PASSWORD">,
): string {
  if (env.deployEnv === "staging" || env.deployEnv === "production") {
    throw new Error(
      "localTestAccountPassword is only valid for development and test deploy environments",
    );
  }
  return env.VS_LOCAL_SEED_PASSWORD ?? "dev-local-listen";
}
