import { NextResponse } from "next/server";
import {
  archiveListensLimitFromQueryParam,
  parseArchiveListenSourceFilter,
  parseArchiveListenTypeFilter,
  parseDashboardAnalyticsRange,
  parseTimeMachineMonthYyyMm,
  utcCalendarMonthBoundsIso,
} from "@vs/db";
import { readCachedArchiveListensPage } from "@/server/cached-read-heavy-queries";
import { attachReadCacheHttpMeta } from "@/server/read-cache-http-meta";
import { requireSoleOwnerPublicListeningAccess } from "@/server/api/public-listening-access";
import { sanitizeDashboardArchiveListenForPublicApi } from "@/server/sanitize-listen-for-public-api";

/**
 * Keyset-paginated archive listens for the sole owner when listening history is public.
 * Same query contract as `GET /api/analytics/archive-listens` (no session).
 */
export async function GET(req: Request): Promise<Response> {
  const gate = await requireSoleOwnerPublicListeningAccess();
  if (!gate.ok) {
    return gate.response;
  }
  const { access, pool } = gate;

  const url = new URL(req.url);
  const monthRaw = url.searchParams.get("month");
  const monthKey = parseTimeMachineMonthYyyMm(monthRaw ?? undefined);
  if (monthRaw !== null && monthRaw.trim() !== "" && monthKey === null) {
    return NextResponse.json({ error: "Invalid month", expected: "YYYY-MM (UTC calendar)" }, { status: 400 });
  }
  const utcWindow = monthKey !== null ? utcCalendarMonthBoundsIso(monthKey) : null;
  if (monthKey !== null && utcWindow === null) {
    return NextResponse.json({ error: "Invalid month bounds" }, { status: 400 });
  }

  const rangeRaw = url.searchParams.get("range");
  const range =
    rangeRaw === undefined || rangeRaw === null || rangeRaw === ""
      ? "all"
      : parseDashboardAnalyticsRange(rangeRaw);
  if (!range) {
    return NextResponse.json(
      {
        error: "Invalid range",
        supported: ["7d", "30d", "90d", "all"],
      },
      { status: 400 },
    );
  }
  if (utcWindow !== null && range !== "all") {
    return NextResponse.json(
      { error: "When month is set, range must be all", supported: ["all"] },
      { status: 400 },
    );
  }

  const source = parseArchiveListenSourceFilter(url.searchParams.get("source"));
  if (!source) {
    return NextResponse.json(
      { error: "Invalid source", supported: ["all", "lastfm", "import", "spotify"] },
      { status: 400 },
    );
  }

  const type = parseArchiveListenTypeFilter(url.searchParams.get("type"));
  if (!type) {
    return NextResponse.json(
      { error: "Invalid type", supported: ["tracks", "artists", "albums"] },
      { status: 400 },
    );
  }

  const afterPlayedAt = url.searchParams.get("after_played_at");
  const afterListenId = url.searchParams.get("after_listen_id");
  const hasAfter = (afterPlayedAt ?? "").trim() !== "" && (afterListenId ?? "").trim() !== "";
  const hasPartialAfter =
    ((afterPlayedAt ?? "").trim() !== "") !== ((afterListenId ?? "").trim() !== "");
  if (hasPartialAfter) {
    return NextResponse.json(
      { error: "Cursor requires both after_played_at and after_listen_id" },
      { status: 400 },
    );
  }

  const limit = archiveListensLimitFromQueryParam(url.searchParams.get("limit"));
  const q = url.searchParams.get("q");

  const { listens, read_cache } = await readCachedArchiveListensPage(pool, {
    userId: access.userId,
    range,
    limit,
    cursor: hasAfter
      ? { played_at: afterPlayedAt!.trim(), listen_id: afterListenId!.trim() }
      : null,
    q,
    source,
    type,
    utcArchiveMonthYyyMm: monthKey,
    playedAtUtcWindow: utcWindow,
  });

  const res = NextResponse.json({
    source: "canonical_listens",
    range,
    limit,
    utc_archive_month: monthKey,
    source_filter: source,
    type_filter: type,
    listens: listens.map(sanitizeDashboardArchiveListenForPublicApi),
    has_more: listens.length === limit,
    read_cache: {
      entries: [read_cache],
      note: "Canonical archive page query; see served_from (miss | store_hit | inflight_wait).",
    },
  });
  attachReadCacheHttpMeta(res, [read_cache]);
  return res;
}
