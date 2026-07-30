import { NextResponse } from "next/server";
import { getPool, parseDashboardAnalyticsRange, recentListensLimitFromQueryParam } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { readCachedDashboardRecentListens } from "@/server/cached-read-heavy-queries";
import { attachReadCacheHttpMeta } from "@/server/read-cache-http-meta";
import { emailVerificationRequiredUnlessSatisfied } from "@/server/api/email-verification-api-gate";
import { withApiSession } from "@/server/api/require-session";
import { sanitizeDashboardRecentListenForPublicApi } from "@/server/sanitize-listen-for-public-api";
import type { ReadCacheTelemetryEntry } from "@/server/user-scoped-ttl-read-cache";

/**
 * Newest canonical listens first for the signed-in user.
 * Query: `range` — `7d` | `30d` | `90d` | `all` (default `30d`); `limit` — 1..100 (default 50).
 */
export async function GET(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const denied = emailVerificationRequiredUnlessSatisfied(user);
    if (denied) {
      return denied;
    }
    const url = new URL(req.url);
    const range = parseDashboardAnalyticsRange(url.searchParams.get("range"));
    if (!range) {
      return NextResponse.json(
        {
          error: "Invalid range",
          supported: ["7d", "30d", "90d", "all"],
        },
        { status: 400 },
      );
    }

    const limit = recentListensLimitFromQueryParam(
      url.searchParams.get("limit"),
    );

    const env = loadServerEnv();
    const pool = getPool(env);
    const { listens, read_cache } = await readCachedDashboardRecentListens(pool, {
      userId: user.id,
      range,
      limit,
    });

    const res = NextResponse.json({
      source: "canonical_listens",
      range,
      limit,
      listens: listens.map(sanitizeDashboardRecentListenForPublicApi),
      read_cache: {
        entries: [read_cache],
        note: "Canonical listens query; see served_from (miss | store_hit | inflight_wait).",
      },
    });
    attachReadCacheHttpMeta(res, [read_cache]);
    return res;
  });
}
