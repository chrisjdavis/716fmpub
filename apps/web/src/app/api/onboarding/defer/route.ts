import { NextResponse } from "next/server";
import { getPool, setOnboardingDeferred, tryInsertSecurityAuditEvent } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { withApiSession } from "@/server/api/require-session";
import { loadOnboardingStatePayload } from "@/server/onboarding-state-response";

export async function POST(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const env = loadServerEnv();
    const pool = getPool(env);
    await setOnboardingDeferred(pool, user.id);
    await tryInsertSecurityAuditEvent(pool, {
      actorUserId: user.id,
      action: "onboarding.defer",
      outcome: "success",
      metadata: {},
    });
    const payload = await loadOnboardingStatePayload({ pool, user });
    return NextResponse.json({ ok: true as const, onboarding: payload });
  });
}
