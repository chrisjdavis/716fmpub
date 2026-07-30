import { NextResponse } from "next/server";
import { getPool } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { readCachedCanonicalDashboardListenSummary } from "@/server/cached-read-heavy-queries";
import { attachReadCacheHttpMeta } from "@/server/read-cache-http-meta";
import { parseAnalyticsWindowQuery } from "@/server/api/analytics-window-query";
import { emailVerificationRequiredUnlessSatisfied } from "@/server/api/email-verification-api-gate";
import { withApiSession } from "@/server/api/require-session";

/**
 * Rolling-window or UTC-month **play count only** from **canonical `listens` SQL** (same bounded
 * read path as the `GET /api/analytics/summary` fallback). Intentionally does **not** read
 * `dashboard_bundle_v1` so Core accounts never touch that snapshot row for tape counts.
 *
 * Advanced-gated listen summaries (including snapshot-backed top lists) stay on
 * `GET /api/analytics/summary`.
 *
 * Query: same `range` and `month` contract as {@link import("../summary/route").GET}.
 */
export async function GET(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const denied = emailVerificationRequiredUnlessSatisfied(user);
    if (denied) {
      return denied;
    }
    const url = new URL(req.url);
    const parsed = parseAnalyticsWindowQuery(url);
    if (parsed instanceof NextResponse) {
      return parsed;
    }
    const { monthKey, playedAtUtcWindow, hasMonth, effectiveRange } = parsed;

    const env = loadServerEnv();
    const pool = getPool(env);
    const monthWindow =
      hasMonth && playedAtUtcWindow !== null ? { playedAtUtcWindow } : undefined;
    const { summary, read_cache } = await readCachedCanonicalDashboardListenSummary(
      pool,
      user.id,
      hasMonth ? "all" : effectiveRange,
      monthWindow,
    );

    const res = NextResponse.json({
      total_scrobbles: summary.total_scrobbles,
      source: "canonical_listens" as const,
      read_cache: {
        entries: [read_cache],
        note: "Canonical SQL path only; no analytics_snapshots dashboard_bundle read. See served_from for miss vs store_hit vs inflight_wait.",
      },
      ...(monthKey !== null ? { utc_archive_month: monthKey } : {}),
    });
    attachReadCacheHttpMeta(res, [read_cache]);
    return res;
  });
}
