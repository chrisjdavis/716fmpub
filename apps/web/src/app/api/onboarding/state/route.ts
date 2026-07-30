import { NextResponse } from "next/server";
import { getPool } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { loadOnboardingStatePayload } from "@/server/onboarding-state-response";
import { withApiSession } from "@/server/api/require-session";

export async function GET(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const env = loadServerEnv();
    const pool = getPool(env);
    const payload = await loadOnboardingStatePayload({ pool, user });
    return NextResponse.json(payload);
  });
}
