import { getPool, getSoleOwnerPublicListeningAccess } from "@vs/db";
import { loadServerEnv } from "@vs/env";

/** True when this single-user instance has opted into public Explore/Archive. */
export async function isPublicListeningHistoryEnabled(): Promise<boolean> {
  const env = loadServerEnv();
  const pool = getPool(env);
  const access = await getSoleOwnerPublicListeningAccess(pool);
  return access !== null;
}
