import { getPool, parseTimeMachineMonthYyyMm, type DashboardAnalyticsRange } from "@vs/db";
import { sanitizeUserFacingPlainText } from "@vs/domain";
import { loadServerEnv } from "@vs/env";
import { redirect } from "next/navigation";
import { getServerSession } from "@/server/auth/get-server-session";
import { redirectIfDashboardShellLocked } from "@/server/dashboard-shell-lock";
import {
  ARCHIVE_INITIAL_PAGE_SIZE,
  loadArchiveListenHighlightsForEntitledWindow,
  loadArchivePageData,
} from "@/server/archive-page-data";
import { userMayReadAiLayer1Outputs } from "@/server/ai-layer1-entitlement";
import { ArchiveBrowser } from "./archive-browser";

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

export default async function ArchivePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ month?: string | string[]; range?: string | string[] }>;
}>) {
  const session = await getServerSession();
  if (!session) {
    redirect("/login?next=%2Fdashboard%2Farchive");
  }
  const env = loadServerEnv();
  const pool = getPool(env);
  await redirectIfDashboardShellLocked(pool, session);
  const sp = await searchParams;
  const monthRaw = firstSearchParam(sp.month);
  const rangeRaw = firstSearchParam(sp.range);
  if (monthRaw !== undefined && String(monthRaw).trim() !== "") {
    const m = parseTimeMachineMonthYyyMm(monthRaw);
    if (m === null) {
      redirect("/dashboard/archive");
    }
  }
  const rangeParsed = parseArchiveRangeSearchParam(rangeRaw);
  if (rangeRaw !== undefined && String(rangeRaw).trim() !== "" && rangeParsed === null) {
    redirect("/dashboard/archive");
  }
  const initialAnalyticsRange: DashboardAnalyticsRange = rangeParsed ?? "all";
  const utcArchiveMonthYyyMm = parseTimeMachineMonthYyyMm(monthRaw ?? null);

  const allowAi = userMayReadAiLayer1Outputs(session.productPlan);
  const [{ archiveListenSummary, firstListenAt, initialListens, initialHasMore }, highlightModel] =
    await Promise.all([
      loadArchivePageData(pool, session.id, {
        utcArchiveMonthYyyMm,
        allowAiLayer1Reads: allowAi,
      }),
      loadArchiveListenHighlightsForEntitledWindow(pool, session.id, {
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

  return (
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
      />
    </main>
  );
}
