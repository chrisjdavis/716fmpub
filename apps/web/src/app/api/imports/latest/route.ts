import { NextResponse } from "next/server";
import { getLatestDashboardImportJobForUser, getPool } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { importJobApiRowFromRecord } from "@/server/api/import-job-row";
import { emailVerificationRequiredUnlessSatisfied } from "@/server/api/email-verification-api-gate";
import { withApiSession } from "@/server/api/require-session";

/**
 * Latest Last.fm import job for the signed-in user (by `created_at desc`), or `null` when none exist.
 */
export async function GET(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const denied = emailVerificationRequiredUnlessSatisfied(user);
    if (denied) {
      return denied;
    }
    const env = loadServerEnv();
    const pool = getPool(env);
    const record = await getLatestDashboardImportJobForUser(pool, user.id);
    if (!record) {
      return NextResponse.json({ latest: null });
    }
    return NextResponse.json({ latest: importJobApiRowFromRecord(record) });
  });
}
