import { NextResponse } from "next/server";
import { z } from "zod";
import { ANALYTICS_SNAPSHOTS_REPLACE_UPSERT_RETURNING_UPDATED_AT_SQL, getPool } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { redactZodFlattenForPublicApi } from "@vs/sensitive";
import { requireInternalApiAuth } from "@/server/api/internal-api-auth";
import { invalidateListeningHistoryDerivedReadCaches } from "@/server/listening-history-read-cache-invalidation";
import { withPublicApiRouteTiming } from "@/server/observability/public-api-timing";

/** Legacy `analytics_snapshots` row kind previously upserted via authenticated POST. */
const SNAPSHOT_KIND = "dashboard_default" as const;

const postBodySchema = z.object({
  user_id: z.string().uuid(),
  body: z.record(z.string(), z.unknown()),
});

/**
 * Operator-only upsert for `dashboard_default` analytics snapshots.
 * Auth: `Authorization: Bearer <VS_INTERNAL_API_SECRET>` (see `docs/security-architecture.md`).
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
  const { rows } = await pool.query<{ updated_at: string }>(
    ANALYTICS_SNAPSHOTS_REPLACE_UPSERT_RETURNING_UPDATED_AT_SQL,
    [parsed.data.user_id, SNAPSHOT_KIND, JSON.stringify(parsed.data.body)],
  );
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "Upsert failed" }, { status: 500 });
  }
  invalidateListeningHistoryDerivedReadCaches(parsed.data.user_id);
  return NextResponse.json({
    kind: SNAPSHOT_KIND,
    user_id: parsed.data.user_id,
    updated_at: row.updated_at,
  });
  });
}
