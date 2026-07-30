import type { Pool } from "pg";
import {
  getUserTimeMachineMonthMetrics,
  getUserTimeMachineYearMetrics,
  listUserNewArtistsFirstPlayInUtcWindowRanked,
  listUserTimeMachineMonthDensity,
  listUserTimeMachineMonthTopAlbumsForExploreAnchors,
  listUserTimeMachineMonthTopTracksForExploreAnchors,
  nextUtcCalendarMonthYyyMm,
  parseTimeMachineMonthYyyMm,
  previousUtcCalendarMonthYyyMm,
  sameUtcCalendarMonthOneYearPriorYyyMm,
  utcCalendarMonthBoundsIso,
  utcCalendarYearStartYmdFromMonthYyyMm,
  type TimeMachineMonthDensityRow,
  type TimeMachineMonthMetricsRow,
  type TimeMachineTimelineView,
} from "@vs/db";
import type { ImportJobApiRow } from "@/server/api/import-job-row";
import {
  buildTimeMachineExploreCopy,
  type TimeMachineExploreCopy,
} from "@/server/dashboard-time-machine-briefing";
import {
  buildTimeMachineExploreAnchorStrip,
  type TimeMachineExploreAnchorStrip,
} from "@/server/time-machine-explore-visuals";

export type { TimeMachineTimelineView } from "@vs/db";

export type TimeMachineExploreModel = Readonly<{
  monthYyyMm: string;
  /** Full listening timeline; scrubber may filter to {@link TimeMachineTimelineView}. */
  timeline: readonly TimeMachineMonthDensityRow[];
  timelineView: TimeMachineTimelineView;
  metrics: TimeMachineMonthMetricsRow | null;
  prior: TimeMachineMonthMetricsRow | null;
  sameMonthPriorYear: TimeMachineMonthMetricsRow | null;
  yearMetrics: TimeMachineMonthMetricsRow | null;
  newArtistCount: number;
  copy: TimeMachineExploreCopy;
  /** Cover-led strip between summary and support cards; null when thin / no plays. */
  anchorStrip: TimeMachineExploreAnchorStrip | null;
  /** `YYYY-MM-DD` UTC first day — matches `user_listen_period_metrics.period_start`. */
  periodStartYmd: string;
}>;

function yyyymmToPeriodStartYmd(yyyymm: string): string {
  return `${yyyymm}-01`;
}

function pickDefaultMonth(
  timeline: readonly TimeMachineMonthDensityRow[],
  wallMonthYyyMm: string,
): string {
  if (timeline.length === 0) {
    return wallMonthYyyMm;
  }
  const latest = timeline[timeline.length - 1]?.period_start;
  return latest !== undefined ? latest.slice(0, 7) : wallMonthYyyMm;
}

function pickDefaultMonthNewMusic(
  newMusicMonths: readonly TimeMachineMonthDensityRow[],
  wallMonthYyyMm: string,
): string {
  if (newMusicMonths.length === 0) {
    return wallMonthYyyMm;
  }
  const latest = newMusicMonths[newMusicMonths.length - 1]?.period_start;
  return latest !== undefined ? latest.slice(0, 7) : wallMonthYyyMm;
}

function parseTimelineViewParam(raw: string | null | undefined): TimeMachineTimelineView {
  return String(raw ?? "").trim() === "new-music" ? "new-music" : "full";
}

function utcWallMonthYyyMm(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

/**
 * Loads Musical Time Machine data for `/dashboard/explore`.
 * Month keys are UTC `YYYY-MM` aligned with {@link user_listen_period_metrics}.
 */
export async function loadTimeMachineExploreModel(
  pool: Pool,
  input: Readonly<{
    userId: string;
    monthParam: string | null | undefined;
    viewParam: string | null | undefined;
    job: ImportJobApiRow;
    allowAiLayer1Reads: boolean;
  }>,
): Promise<TimeMachineExploreModel | null> {
  if (!input.allowAiLayer1Reads) {
    return null;
  }
  if (input.job.stage !== "completed") {
    return null;
  }

  const timeline = await listUserTimeMachineMonthDensity(pool, input.userId);
  const wallMonth = utcWallMonthYyyMm(Date.now());
  const newMusicMonths = timeline.filter((r) => r.new_artist_count > 0);
  const requestedView = parseTimelineViewParam(input.viewParam);
  const timelineView: TimeMachineTimelineView =
    requestedView === "new-music" && newMusicMonths.length > 0 ? "new-music" : "full";

  const parsed = parseTimeMachineMonthYyyMm(input.monthParam ?? null);
  let monthYyyMm =
    parsed ??
    (timelineView === "new-music"
      ? pickDefaultMonthNewMusic(newMusicMonths, wallMonth)
      : pickDefaultMonth(timeline, wallMonth));

  if (timelineView === "new-music") {
    const inFiltered = newMusicMonths.some((r) => r.period_start.slice(0, 7) === monthYyyMm);
    if (!inFiltered) {
      monthYyyMm = pickDefaultMonthNewMusic(newMusicMonths, wallMonth);
    }
  }

  const periodStartYmd = yyyymmToPeriodStartYmd(monthYyyMm);
  const bounds = utcCalendarMonthBoundsIso(monthYyyMm);
  if (!bounds) {
    return null;
  }

  const priorKey = previousUtcCalendarMonthYyyMm(monthYyyMm);
  const priorYearMonthKey = sameUtcCalendarMonthOneYearPriorYyyMm(monthYyyMm);
  const yearStartYmd = utcCalendarYearStartYmdFromMonthYyyMm(monthYyyMm);
  const nextMonthKey = nextUtcCalendarMonthYyyMm(monthYyyMm);

  const [
    metrics,
    prior,
    sameMonthPriorYear,
    yearMetrics,
    nextMonth,
    newArtistPack,
    anchorTracks,
    anchorAlbums,
  ] = await Promise.all([
    getUserTimeMachineMonthMetrics(pool, { userId: input.userId, periodStartYmd }),
    priorKey !== null
      ? getUserTimeMachineMonthMetrics(pool, {
          userId: input.userId,
          periodStartYmd: yyyymmToPeriodStartYmd(priorKey),
        })
      : Promise.resolve(null),
    priorYearMonthKey !== null
      ? getUserTimeMachineMonthMetrics(pool, {
          userId: input.userId,
          periodStartYmd: yyyymmToPeriodStartYmd(priorYearMonthKey),
        })
      : Promise.resolve(null),
    yearStartYmd !== null
      ? getUserTimeMachineYearMetrics(pool, {
          userId: input.userId,
          periodStartYmd: yearStartYmd,
        })
      : Promise.resolve(null),
    nextMonthKey !== null
      ? getUserTimeMachineMonthMetrics(pool, {
          userId: input.userId,
          periodStartYmd: yyyymmToPeriodStartYmd(nextMonthKey),
        })
      : Promise.resolve(null),
    listUserNewArtistsFirstPlayInUtcWindowRanked(pool, {
      userId: input.userId,
      gteIso: bounds.gteIso,
      ltExclusiveIso: bounds.ltExclusiveIso,
    }),
    listUserTimeMachineMonthTopTracksForExploreAnchors(pool, {
      userId: input.userId,
      gteIso: bounds.gteIso,
      ltExclusiveIso: bounds.ltExclusiveIso,
      limit: 56,
    }),
    listUserTimeMachineMonthTopAlbumsForExploreAnchors(pool, {
      userId: input.userId,
      gteIso: bounds.gteIso,
      ltExclusiveIso: bounds.ltExclusiveIso,
      limit: 56,
    }),
  ]);

  const { artists: newArtistRows, totalCount: newArtistCount } = newArtistPack;
  const newArtistsRanked = newArtistRows.map((r) => ({
    name: r.artistName,
    playsInPeriod: r.playsInWindow,
  }));

  const exploreCharts =
    metrics !== null && metrics.play_count >= 1
      ? { topTracks: anchorTracks, topAlbums: anchorAlbums }
      : null;

  const copy = buildTimeMachineExploreCopy({
    monthYyyMm,
    metrics,
    prior,
    sameMonthPriorYear,
    yearMetrics,
    newArtistCount,
    newArtistsRanked,
    timeline,
    nextMonth,
    exploreCharts,
  });

  const anchorStrip =
    metrics !== null && metrics.play_count >= 1
      ? buildTimeMachineExploreAnchorStrip({
          monthYyyMm,
          metrics,
          topTracks: anchorTracks,
          topAlbums: anchorAlbums,
          newArtistsRanked,
        })
      : null;

  return {
    monthYyyMm,
    timeline,
    timelineView,
    metrics,
    prior,
    sameMonthPriorYear,
    yearMetrics,
    newArtistCount,
    copy,
    anchorStrip,
    periodStartYmd,
  };
}
