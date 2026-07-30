import {
  getPool,
  getSoleOwnerPublicListeningAccess,
  parseTimeMachineMonthYyyMm,
  type DashboardAnalyticsRange,
} from "@vs/db";
import { sanitizeUserFacingPlainText } from "@vs/domain";
import type { ProductPlan } from "@vs/domain";
import { loadServerEnv } from "@vs/env";
import { redirect } from "next/navigation";
import { ArchiveBrowser } from "@/app/dashboard/archive/archive-browser";
import { DashboardDisplayTimeZoneProvider } from "@/app/dashboard/dashboard-display-timezone-context";
import {
  PublicListeningShell,
  PublicListeningUnavailable,
} from "@/components/public-listening-shell";
import { userMayReadAiLayer1Outputs } from "@/server/ai-layer1-entitlement";
import {
  ARCHIVE_INITIAL_PAGE_SIZE,
  loadArchiveListenHighlightsForEntitledWindow,
  loadArchivePageData,
} from "@/server/archive-page-data";
import { isInstanceConfigured } from "@/server/instance-configured";
import {
  PUBLIC_ANALYTICS_API_BASE,
  PUBLIC_ARCHIVE_PATH,
} from "@/server/listening-surface-routes";

export const dynamic = "force-dynamic";

function firstSearchParam(v: string | string[] | undefined): string | undefined {
  if (v === undefined) {
    return undefined;
  }
  return Array.isArray(v) ? v[0] : v;
}

function parseArchiveRangeSearchParam(raw: string | undefined): DashboardAnalyticsRange | null {
  if (raw === undefined) {
    return null;
  }
  const t = String(raw).trim();
  if (t === "") {
    return null;
  }
  if (t === "7d" || t === "30d" || t === "90d" || t === "all") {
    return t;
  }
  return null;
}

function asProductPlan(raw: string): ProductPlan {
  if (raw === "advanced" || raw === "core") {
    return raw;
  }
  return "advanced";
}

export default async function PublicArchivePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ month?: string | string[]; range?: string | string[] }>;
}>) {
  if (!(await isInstanceConfigured())) {
    redirect("/setup");
  }

  const env = loadServerEnv();
  const pool = getPool(env);
  const access = await getSoleOwnerPublicListeningAccess(pool);
  if (!access) {
    return (
      <PublicListeningShell active="archive">
        <PublicListeningUnavailable />
      </PublicListeningShell>
    );
  }

  const sp = await searchParams;
  const monthRaw = firstSearchParam(sp.month);
  const rangeRaw = firstSearchParam(sp.range);
  if (monthRaw !== undefined && String(monthRaw).trim() !== "") {
    const m = parseTimeMachineMonthYyyMm(monthRaw);
    if (m === null) {
      redirect(PUBLIC_ARCHIVE_PATH);
    }
  }
  const rangeParsed = parseArchiveRangeSearchParam(rangeRaw);
  if (rangeRaw !== undefined && String(rangeRaw).trim() !== "" && rangeParsed === null) {
    redirect(PUBLIC_ARCHIVE_PATH);
  }
  const initialAnalyticsRange: DashboardAnalyticsRange = rangeParsed ?? "all";
  const utcArchiveMonthYyyMm = parseTimeMachineMonthYyyMm(monthRaw ?? null);
  const allowAi = userMayReadAiLayer1Outputs(asProductPlan(access.product_plan));

  const [{ archiveListenSummary, firstListenAt, initialListens, initialHasMore }, highlightModel] =
    await Promise.all([
      loadArchivePageData(pool, access.userId, {
        utcArchiveMonthYyyMm,
        allowAiLayer1Reads: allowAi,
      }),
      loadArchiveListenHighlightsForEntitledWindow(pool, access.userId, {
        analyticsRange: initialAnalyticsRange,
        utcArchiveMonthYyyMm,
        allowAiLayer1Reads: allowAi,
      }),
    ]);
  const topAlbumH = highlightModel.top_album;
  const artistCoverH = highlightModel.top_artist_cover;
  const highlightAlbum =
    topAlbumH != null
      ? {
          title: sanitizeUserFacingPlainText(topAlbumH.title),
          artistName: sanitizeUserFacingPlainText(topAlbumH.artist_name),
          plays: topAlbumH.plays,
          musicbrainz_release_mbid: topAlbumH.musicbrainz_release_mbid,
          lastfm_cover_image_url: topAlbumH.lastfm_cover_image_url,
        }
      : null;
  const topArtistH = highlightModel.top_artist;
  const highlightArtist =
    topArtistH != null
      ? {
          name: sanitizeUserFacingPlainText(topArtistH.name),
          plays: topArtistH.plays,
          musicbrainz_release_mbid: artistCoverH?.musicbrainz_release_mbid ?? null,
          lastfm_cover_image_url: artistCoverH?.lastfm_cover_image_url ?? null,
        }
      : null;

  const displayTimeZone = access.stats_timezone?.trim() || "UTC";

  return (
    <PublicListeningShell active="archive">
      <DashboardDisplayTimeZoneProvider value={displayTimeZone}>
        <main className="flex min-h-0 flex-1 flex-col">
          <ArchiveBrowser
            allowAiLayer1Reads={allowAi}
            initialListens={initialListens}
            initialHasMore={initialHasMore}
            totalPlays={archiveListenSummary.total_scrobbles}
            initialTapeWindowTotalScrobbles={highlightModel.total_scrobbles}
            firstListenAt={firstListenAt}
            initialHighlightAlbum={highlightAlbum}
            initialHighlightArtist={highlightArtist}
            initialPageSize={ARCHIVE_INITIAL_PAGE_SIZE}
            initialUtcArchiveMonthYyyMm={utcArchiveMonthYyyMm}
            initialAnalyticsRange={initialAnalyticsRange}
            analyticsApiBase={PUBLIC_ANALYTICS_API_BASE}
          />
        </main>
      </DashboardDisplayTimeZoneProvider>
    </PublicListeningShell>
  );
}
