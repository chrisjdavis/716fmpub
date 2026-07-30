import { NextResponse } from "next/server";
import { getPool, listSecurityAuditEvents } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { z } from "zod";
import { requireInternalApiAuth } from "@/server/api/internal-api-auth";
import { withPublicApiRouteTiming } from "@/server/observability/public-api-timing";

const userIdQuerySchema = z.string().uuid();

export async function GET(req: Request): Promise<Response> {
  return withPublicApiRouteTiming(req, async () => {
  const env = loadServerEnv();
  const denied = requireInternalApiAuth(req, env);
  if (denied) {
    return denied;
  }

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limitParsed = limitRaw === null || limitRaw.trim() === "" ? 100 : Number(limitRaw);
  const limit = Number.isFinite(limitParsed) ? limitParsed : 100;

  const userIdParam = url.searchParams.get("userId");
  let actorUserId: string | null | undefined;
  if (userIdParam === null || userIdParam.trim() === "") {
    actorUserId = undefined;
  } else {
    const parsed = userIdQuerySchema.safeParse(userIdParam.trim());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "userId must be a UUID when provided", code: "invalid_user_id" },
        { status: 400 },
      );
    }
    actorUserId = parsed.data;
  }

  const pool = getPool(env);
  const events = await listSecurityAuditEvents(pool, {
    actorUserId: actorUserId === undefined ? null : actorUserId,
    limit,
  });

  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      occurredAt: e.occurred_at,
      actorUserId: e.actor_user_id,
      action: e.action,
      outcome: e.outcome,
      metadata: e.metadata,
    })),
  });
  });
}
