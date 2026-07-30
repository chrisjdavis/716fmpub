import type { Pool } from "pg";
import {
  archiveListenPageSummaryFromDashboardAllSummary,
  getArchiveListensPage,
  tryReadFreshDashboardAnalyticsBundle,
  utcCalendarMonthBoundsIso,
  type ArchiveListenPageSummary,
  type DashboardAnalyticsRange,
  type DashboardArchiveListen,
} from "@vs/db";
import {
  readCachedArchiveListensPage,
  readCachedArchiveShellHeaderFallback,
  readCachedCanonicalDashboardListenSummary,
} from "@/server/cached-read-heavy-queries";
import { sanitizeDashboardArchiveListenForPublicApi } from "@/server/sanitize-listen-for-public-api";

/** First archive page size (keep in sync with `archive-browser` request default). */
export const ARCHIVE_INITIAL_PAGE_SIZE = 40;

/**
 * Archive SSR model. {@link ArchiveListenPageSummary} is all-time totals plus top artist/album,
 * not a full {@link import("@vs/db").DashboardListenSummary}.
 */
export type ArchivePageModel = {
  archiveListenSummary: ArchiveListenPageSummary;
  firstListenAt: string | null;
  initialListens: DashboardArchiveListen[];
  /** True when the server returned a full first page (client may request more). */
  initialHasMore: boolean;
  /** When set, initial list is scoped to this UTC calendar month (`YYYY-MM`). */
  utcArchiveMonthYyyMm: string | null;
};

export type ArchivePageShellModel = Pick<ArchivePageModel, "archiveListenSummary" | "firstListenAt">;

/**
 * Top-artist / top-album aggregates for the archive highlight cards for the selected rolling
 * `analyticsRange`, or for a Stats time-machine UTC month when `utcArchiveMonthYyyMm` is set.
 */
export async function loadArchiveListenHighlightsForWindow(
  pool: Pool,
  userId: string,
  input: Readonly<{
    analyticsRange: DashboardAnalyticsRange;
    utcArchiveMonthYyyMm: string | null;
  }>,
): Promise<ArchiveListenPageSummary> {
  const { analyticsRange, utcArchiveMonthYyyMm } = input;
  const playedAtUtcWindow =
    utcArchiveMonthYyyMm !== null ? utcCalendarMonthBoundsIso(utcArchiveMonthYyyMm) : null;

  const bundle = await tryReadFreshDashboardAnalyticsBundle(pool, userId);
  if (bundle && playedAtUtcWindow === null) {
    return archiveListenPageSummaryFromDashboardAllSummary(
      bundle.ranges[analyticsRange].summary,
    );
  }

  const { summary } = await readCachedCanonicalDashboardListenSummary(
    pool,
    userId,
    playedAtUtcWindow !== null ? "all" : analyticsRange,
    playedAtUtcWindow !== null ? { playedAtUtcWindow } : undefined,
  );
  return archiveListenPageSummaryFromDashboardAllSummary(summary);
}

/**
 * Same window as {@link loadArchiveListenHighlightsForWindow}, but **Core** users only receive
 * `total_scrobbles` from the canonical listens path (aligned with `GET /api/analytics/window-total`).
 * Top highlights are omitted so the browser never hydrates Advanced-gated rollup payloads.
 */
export async function loadArchiveListenHighlightsForEntitledWindow(
  pool: Pool,
  userId: string,
  input: Readonly<{
    analyticsRange: DashboardAnalyticsRange;
    utcArchiveMonthYyyMm: string | null;
    allowAiLayer1Reads: boolean;
  }>,
): Promise<ArchiveListenPageSummary> {
  if (!input.allowAiLayer1Reads) {
    const playedAtUtcWindow =
      input.utcArchiveMonthYyyMm !== null
        ? utcCalendarMonthBoundsIso(input.utcArchiveMonthYyyMm)
        : null;
    const { summary } = await readCachedCanonicalDashboardListenSummary(
      pool,
      userId,
      playedAtUtcWindow !== null ? "all" : input.analyticsRange,
      playedAtUtcWindow !== null ? { playedAtUtcWindow } : undefined,
    );
    return {
      total_scrobbles: summary.total_scrobbles,
      top_artist: null,
      top_album: null,
      top_artist_cover: null,
    };
  }
  return loadArchiveListenHighlightsForWindow(pool, userId, {
    analyticsRange: input.analyticsRange,
    utcArchiveMonthYyyMm: input.utcArchiveMonthYyyMm,
  });
}

/**
 * Header strip + provenance for archive (no keyset list query). Used for fast first paint; the
 * list hydrates from `GET /api/analytics/archive-listens` on the client.
 *
 * `allowAiLayer1Reads` defaults to false (VS-88): callers must opt in to the `dashboard_bundle_v1`
 * fast path; Core-equivalent loads use canonical header SQL only.
 */
export async function loadArchivePageShell(
  pool: Pool,
  userId: string,
  options?: Readonly<{
    allowAiLayer1Reads?: boolean;
  }>,
): Promise<ArchivePageShellModel> {
  const allowAiLayer1Reads = options?.allowAiLayer1Reads ?? false;
  const bundle = allowAiLayer1Reads
    ? await tryReadFreshDashboardAnalyticsBundle(pool, userId)
    : null;
  if (bundle) {
    return {
      archiveListenSummary: archiveListenPageSummaryFromDashboardAllSummary(
        bundle.ranges.all.summary,
      ),
      firstListenAt: bundle.archive_totals.firstListenAt,
    };
  }
  const { archiveListenSummary, firstListenAt } = await readCachedArchiveShellHeaderFallback(
    pool,
    userId,
  );
  return { archiveListenSummary, firstListenAt };
}

export async function loadArchivePageData(
  pool: Pool,
  userId: string,
  options?: Readonly<{
    utcArchiveMonthYyyMm?: string | null;
    /**
     * When false (default), skips the fresh `dashboard_bundle_v1` fast path so archive SSR never
     * depends on Advanced-gated snapshot materialization (canonical listens + header fallback only).
     * Product routes pass true only when `userMayReadAiLayer1Outputs(session.productPlan)` is true.
     */
    allowAiLayer1Reads?: boolean;
  }>,
): Promise<ArchivePageModel> {
  const utcArchiveMonthYyyMm = options?.utcArchiveMonthYyyMm ?? null;
  const allowAiLayer1Reads = options?.allowAiLayer1Reads ?? false;
  const playedAtUtcWindow =
    utcArchiveMonthYyyMm !== null ? utcCalendarMonthBoundsIso(utcArchiveMonthYyyMm) : null;

  const bundle = allowAiLayer1Reads
    ? await tryReadFreshDashboardAnalyticsBundle(pool, userId)
    : null;
  if (bundle) {
    const initialListens = await getArchiveListensPage(pool, {
      userId,
      range: "all",
      limit: ARCHIVE_INITIAL_PAGE_SIZE,
      cursor: null,
      q: null,
      source: "all",
      type: "tracks",
      playedAtUtcWindow,
    });
    return {
      archiveListenSummary: archiveListenPageSummaryFromDashboardAllSummary(
        bundle.ranges.all.summary,
      ),
      firstListenAt: bundle.archive_totals.firstListenAt,
      initialListens: initialListens.map(sanitizeDashboardArchiveListenForPublicApi),
      initialHasMore: initialListens.length === ARCHIVE_INITIAL_PAGE_SIZE,
      utcArchiveMonthYyyMm,
    };
  }

  const [{ archiveListenSummary, firstListenAt }, { listens: initialListens }] =
    await Promise.all([
      readCachedArchiveShellHeaderFallback(pool, userId),
      readCachedArchiveListensPage(pool, {
        userId,
        range: "all",
        limit: ARCHIVE_INITIAL_PAGE_SIZE,
        cursor: null,
        q: null,
        source: "all",
        type: "tracks",
        utcArchiveMonthYyyMm,
        playedAtUtcWindow,
      }),
    ]);
  return {
    archiveListenSummary,
    firstListenAt,
    initialListens: initialListens.map(sanitizeDashboardArchiveListenForPublicApi),
    initialHasMore: initialListens.length === ARCHIVE_INITIAL_PAGE_SIZE,
    utcArchiveMonthYyyMm,
  };
}
