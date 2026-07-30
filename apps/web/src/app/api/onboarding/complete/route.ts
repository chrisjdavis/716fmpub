import { NextResponse } from "next/server";
import {
  countListensForUser,
  getPool,
  getUserOnboardingRow,
  isOnboardingInitialImportProcessingComplete,
  markOnboardingCompleted,
  tryInsertSecurityAuditEvent,
} from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { withApiSession } from "@/server/api/require-session";
import { loadOnboardingStatePayload } from "@/server/onboarding-state-response";

export async function POST(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const env = loadServerEnv();
    const pool = getPool(env);
    const row = await getUserOnboardingRow(pool, user.id);
    if (row?.onboarding_state === "completed") {
      const payload = await loadOnboardingStatePayload({ pool, user });
      return NextResponse.json({ ok: true as const, onboarding: payload });
    }
    const listenCount = await countListensForUser(pool, user.id);
    const state = row?.onboarding_state;
    const processingComplete = await isOnboardingInitialImportProcessingComplete(pool, user.id);
    const eligible =
      processingComplete ||
      (listenCount >= 1 &&
        (state === "partial_ready" ||
          state === "import_in_progress" ||
          state === "import_started"));

    if (!eligible) {
      return NextResponse.json(
        {
          ok: false as const,
          error:
            "Wait until your import and stats processing finish, or until listens appear in your archive, before completing setup.",
        },
        { status: 400 },
      );
    }

    await markOnboardingCompleted(pool, user.id);
    await tryInsertSecurityAuditEvent(pool, {
      actorUserId: user.id,
      action: "onboarding.complete",
      outcome: "success",
      metadata: {},
    });
    const payload = await loadOnboardingStatePayload({ pool, user });
    return NextResponse.json({ ok: true as const, onboarding: payload });
  });
}
