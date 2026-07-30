import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { redactZodFlattenForPublicApi } from "@vs/sensitive";
import { requireInternalApiAuth } from "@/server/api/internal-api-auth";
import { trySendOnboardingImportReadyNotificationBestEffort } from "@/server/onboarding-import-ready-notification";
import { withPublicApiRouteTiming } from "@/server/observability/public-api-timing";

const postBodySchema = z.object({
  user_id: z.string().uuid(),
});

/**
 * Worker → web: after listen-period metrics recompute, optionally email the user that onboarding
 * import + stats processing finished. Auth: `Authorization: Bearer <VS_INTERNAL_API_SECRET>`.
 */
export async function POST(req: Request): Promise<Response> {
  return withPublicApiRouteTiming(req, async () => {
    const env = loadServerEnv();
    const denied = requireInternalApiAuth(req, env);
    if (denied) {
      return denied;
    }

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = postBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: redactZodFlattenForPublicApi(parsed.error.flatten()),
        },
        { status: 400 },
      );
    }

    const pool = getPool(env);
    await trySendOnboardingImportReadyNotificationBestEffort(pool, env, parsed.data.user_id);
    return NextResponse.json({ ok: true, user_id: parsed.data.user_id });
  });
}
