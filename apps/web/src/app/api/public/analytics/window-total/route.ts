import { NextResponse } from "next/server";
import { readCachedCanonicalDashboardListenSummary } from "@/server/cached-read-heavy-queries";
import { attachReadCacheHttpMeta } from "@/server/read-cache-http-meta";
import { parseAnalyticsWindowQuery } from "@/server/api/analytics-window-query";
import { requireSoleOwnerPublicListeningAccess } from "@/server/api/public-listening-access";

/**
 * Public play-count window total when listening history is public.
 * Read-only — does not enqueue analytics recompute jobs.
 */
export async function GET(req: Request): Promise<Response> {
  const gate = await requireSoleOwnerPublicListeningAccess();
  if (!gate.ok) {
    return gate.response;
  }
  const { access, pool } = gate;

  const url = new URL(req.url);
  const parsed = parseAnalyticsWindowQuery(url);
  if (parsed instanceof NextResponse) {
    return parsed;
  }
  const { monthKey, playedAtUtcWindow, hasMonth, effectiveRange } = parsed;

  const monthWindow =
    hasMonth && playedAtUtcWindow !== null ? { playedAtUtcWindow } : undefined;
  const { summary, read_cache } = await readCachedCanonicalDashboardListenSummary(
    pool,
    access.userId,
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
}
