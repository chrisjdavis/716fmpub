import { NextResponse } from "next/server";
import { getListenFingerprintForUser, getPool } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { emailVerificationRequiredUnlessSatisfied } from "@/server/api/email-verification-api-gate";
import { withApiSession } from "@/server/api/require-session";

/**
 * Lightweight fingerprint of canonical listens for the signed-in user.
 * Used by the dashboard layout poller to trigger `router.refresh()` when data changes.
 */
export async function GET(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const denied = emailVerificationRequiredUnlessSatisfied(user);
    if (denied) {
      return denied;
    }
    const env = loadServerEnv();
    const pool = getPool(env);
    const fp = await getListenFingerprintForUser(pool, user.id);
    return NextResponse.json(fp);
  });
}
