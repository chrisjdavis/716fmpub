import { countUsers, getPool } from "@vs/db";
import { loadServerEnv } from "@vs/env";

/** True when at least one user row exists (instance already set up). */
export async function isInstanceConfigured(): Promise<boolean> {
  const env = loadServerEnv();
  const n = await countUsers(getPool(env));
  return n > 0;
}
