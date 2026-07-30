import { NextResponse } from "next/server";
import {
  getPool,
  getSoleOwnerPublicListeningAccess,
  type SoleOwnerPublicListeningAccess,
} from "@vs/db";
import { loadServerEnv } from "@vs/env";

/**
 * Resolves the sole owner for public Explore/Archive reads when the opt-in flag is on.
 * Returns a 404 JSON response when unpublished or the instance is not a single-user host.
 */
export async function requireSoleOwnerPublicListeningAccess(): Promise<
  | { ok: true; access: SoleOwnerPublicListeningAccess; pool: ReturnType<typeof getPool> }
  | { ok: false; response: NextResponse }
> {
  const env = loadServerEnv();
  const pool = getPool(env);
  const access = await getSoleOwnerPublicListeningAccess(pool);
  if (!access) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Listening history is not public on this instance",
          code: "listening_history_not_public",
        },
        { status: 404 },
      ),
    };
  }
  return { ok: true, access, pool };
}
