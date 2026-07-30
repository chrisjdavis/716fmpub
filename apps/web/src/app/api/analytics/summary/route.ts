import { NextResponse } from "next/server";
import {
  enqueueLayer1EvidenceRecomputeForUserBestEffort,
  getPool,
  resolveDashboardAnalyticsBundleRead,
} from "@vs/db";
import { requireAdvancedEntitlement } from "@vs/domain";
import { loadServerEnv } from "@vs/env";
import { enqueueDashboardBundleAnalyticsForUserBestEffort } from "@vs/queue";
import { readCachedCanonicalDashboardListenSummary } from "@/server/cached-read-heavy-queries";
import { attachReadCacheHttpMeta } from "@/server/read-cache-http-meta";
import { advancedEntitlementRequiredJsonResponse } from "@/server/api/advanced-entitlement-json-response";
import { parseAnalyticsWindowQuery } from "@/server/api/analytics-window-query";
import { emailVerificationRequiredUnlessSatisfied } from "@/server/api/email-verification-api-gate";
import { withApiSession } from "@/server/api/require-session";
import { sanitizeDashboardListenSummaryForPublicApi } from "@/server/sanitize-dashboard-listen-summary";
import type { ReadCacheTelemetryEntry } from "@/server/user-scoped-ttl-read-cache";

/**
 * Dashboard listen summary: prefers a fresh `dashboard_bundle_v1` snapshot when present;
 * otherwise canonical `listens` SQL. `snapshot_read` explains why a snapshot was not used.
 *
 * Query:
 * - `range` — `7d` | `30d` | `90d` | `all` (default `30d` when omitted, see {@link parseDashboardAnalyticsRange}).
 * - `month` — optional UTC calendar month `YYYY-MM`; when set, aggregates use that half-open window
 *   instead of a rolling `range`, and snapshot rows are not used (canonical SQL only).
 *
 * **Read cache (`read_cache.entries[].served_from`):** `miss` loads SQL; `store_hit` reuses the
 * in-process TTL entry; `inflight_wait` waited on another concurrent miss for the same key (not a
 * store hit). Fewer `miss` events on repeat traffic is the supported latency proxy versus wall-clock
 * benchmarks in CI.
 *
 * **Entitlements (VS-62):** Advanced product plan only. Core accounts receive `403` with
 * `code: advanced_entitlement_required`. For **play counts only** without this bundle payload, use
 * `GET /api/analytics/window-total` (canonical listens SQL — does not read `dashboard_bundle_v1`).
 */
export async function GET(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const denied = emailVerificationRequiredUnlessSatisfied(user);
    if (denied) {
      return denied;
    }
    const advanced = requireAdvancedEntitlement({ productPlan: user.productPlan });
    if (!advanced.ok) {
      return advancedEntitlementRequiredJsonResponse();
    }
    const url = new URL(req.url);
    const parsed = parseAnalyticsWindowQuery(url);
    if (parsed instanceof NextResponse) {
      return parsed;
    }
    const { monthKey, playedAtUtcWindow, hasMonth, effectiveRange } = parsed;

    const env = loadServerEnv();
    const pool = getPool(env);
    const read = await resolveDashboardAnalyticsBundleRead(pool, user.id);
    if (read.status === "fresh" && !hasMonth) {
      const res = NextResponse.json({
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
      return res;
    }

    const [{ summary, read_cache }] = await Promise.all([
      readCachedCanonicalDashboardListenSummary(
        pool,
        user.id,
        hasMonth ? "all" : effectiveRange,
        hasMonth ? { playedAtUtcWindow } : undefined,
      ),
      enqueueDashboardBundleAnalyticsForUserBestEffort(env, user.id),
      enqueueLayer1EvidenceRecomputeForUserBestEffort({
        env,
        db: pool,
        userId: user.id,
        reason: "listen_ingested",
      }),
    ]);

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
      // `month` forces canonical SQL; snapshot may still be fresh (see route docstring).
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
  });
}
