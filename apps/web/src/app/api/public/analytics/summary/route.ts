import { NextResponse } from "next/server";
import { resolveDashboardAnalyticsBundleRead } from "@vs/db";
import { readCachedCanonicalDashboardListenSummary } from "@/server/cached-read-heavy-queries";
import { attachReadCacheHttpMeta } from "@/server/read-cache-http-meta";
import { parseAnalyticsWindowQuery } from "@/server/api/analytics-window-query";
import { requireSoleOwnerPublicListeningAccess } from "@/server/api/public-listening-access";
import { sanitizeDashboardListenSummaryForPublicApi } from "@/server/sanitize-dashboard-listen-summary";
import type { ReadCacheTelemetryEntry } from "@/server/user-scoped-ttl-read-cache";

/**
 * Public listen summary (highlights) when listening history is public.
 * Read-only — does not enqueue dashboard-bundle or Layer-1 recompute jobs.
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

  const read = await resolveDashboardAnalyticsBundleRead(pool, access.userId);
  if (read.status === "fresh" && !hasMonth) {
    return NextResponse.json({
      source: "analytics_snapshot",
      snapshot_as_of: read.bundle.as_of,
      summary: sanitizeDashboardListenSummaryForPublicApi(
        read.bundle.ranges[effectiveRange].summary,
      ),
      snapshot_read: { status: "fresh" as const },
      read_cache: {
        entries: [] as ReadCacheTelemetryEntry[],
        note: "Authoritative snapshot row; process read-cache not used.",
      },
    });
  }

  const { summary, read_cache } = await readCachedCanonicalDashboardListenSummary(
    pool,
    access.userId,
    hasMonth ? "all" : effectiveRange,
    hasMonth ? { playedAtUtcWindow } : undefined,
  );

  let snapshot_read:
    | { status: "missing" }
    | { status: "invalid_body" }
    | { status: "stale"; snapshot_as_of: string }
    | { status: "fresh" };
  if (read.status === "missing") {
    snapshot_read = { status: "missing" };
  } else if (read.status === "invalid_body") {
    snapshot_read = { status: "invalid_body" };
  } else if (read.status === "stale") {
    snapshot_read = { status: "stale", snapshot_as_of: read.snapshot_as_of };
  } else {
    snapshot_read = { status: "fresh" };
  }

  const res = NextResponse.json({
    source: "canonical_listens",
    summary: sanitizeDashboardListenSummaryForPublicApi(summary),
    snapshot_read,
    read_cache: {
      entries: [read_cache],
      note: "Canonical SQL path; bounded by TTL. See served_from for miss vs store_hit vs inflight_wait.",
    },
    ...(monthKey !== null ? { utc_archive_month: monthKey } : {}),
  });
  attachReadCacheHttpMeta(res, [read_cache]);
  return res;
}
