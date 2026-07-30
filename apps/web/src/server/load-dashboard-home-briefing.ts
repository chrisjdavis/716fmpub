import type { Pool } from "pg";
import {
  getDashboardHeroWindowMetrics,
  getDashboardListenSummary,
  getUserProfileFields,
  isPlausibleRollingSevenDayListenSummary,
  playedAtLowerBoundUtc,
  queryBriefingReturnAfterGapInsight,
  tryReadFreshHomeBriefingSnapshot,
  upsertHomeBriefingSnapshot,
} from "@vs/db";
import { readFreshDashboardAnalyticsBundleForRequest } from "@/server/dashboard-analytics-bundle-request-cache";
import type { ImportJobApiRow } from "@/server/api/import-job-row";
import {
  buildDashboardHomeAdvancedGateBriefing,
  buildDashboardHomeBriefing,
  parseDashboardHomeBriefingFromJson,
} from "@/server/dashboard-home-briefing";
import {
  calendarHourInTimeZone,
  formatYmdInTimeZone,
} from "@/server/dashboard-home-briefing-calendar";
import { resolveBriefingIANATimeZoneFromProfileAndHeaders } from "@/server/infer-briefing-time-zone";
import { loadDashboardCompletedStats } from "@/server/dashboard-page-data";

const HOME_RANGE = "7d" as const;
const BRIEFING_TOP_LIMIT = 12;

const RETURN_GAP_MS = 30 * 86_400_000;

/**
 * Bounded reads + optional `analytics_snapshots` row (`home_briefing_v1`) so the home surface
 * avoids repeating heavy rollups on every navigation.
 */
export async function loadDashboardHomeBriefingForCompletedHome(
  pool: Pool,
  input: Readonly<{
    userId: string;
    displayName: string | null;
    job: ImportJobApiRow;
    headers: Headers;
    allowAiLayer1Reads: boolean;
  }>,
) {
  const profile = await getUserProfileFields(pool, input.userId);
  const tz = resolveBriefingIANATimeZoneFromProfileAndHeaders(profile?.stats_timezone, input.headers);
  if (!input.allowAiLayer1Reads) {
    return buildDashboardHomeAdvancedGateBriefing({
      nowMs: Date.now(),
      displayName: input.displayName,
      calendarTimeZone: tz,
    });
  }
  const wallNowMs = Date.now();
  const calendarYmd = formatYmdInTimeZone(wallNowMs, tz);

  const cached = await tryReadFreshHomeBriefingSnapshot(pool, {
    userId: input.userId,
    timeZone: tz,
    calendarYmd,
  });
  if (cached) {
    const parsed = parseDashboardHomeBriefingFromJson(cached.briefing);
    if (parsed) {
      return parsed;
    }
  }

  const bundle = await readFreshDashboardAnalyticsBundleForRequest(pool, input.userId);
  const anchorMs = bundle ? Date.parse(bundle.as_of) : wallNowMs;
  const safeAnchor = Number.isFinite(anchorMs) ? anchorMs : wallNowMs;

  const since = playedAtLowerBoundUtc(HOME_RANGE, safeAnchor);
  if (!since) {
    throw new Error("loadDashboardHomeBriefingForCompletedHome: expected 7d lower bound");
  }

  const heroCalendar = {
    timelineDayStartYmd: formatYmdInTimeZone(since.getTime(), tz),
    timelineDayEndYmd: formatYmdInTimeZone(safeAnchor, tz),
    ianaTimeZone: tz,
  };

  const priorAnchor = safeAnchor - 7 * 86_400_000;
  const yearAgoAnchor = safeAnchor - 365 * 86_400_000;

  const [completed, priorWeekSummary, yearAgoSummaryRaw, heroWindow] = await Promise.all([
    loadDashboardCompletedStats(pool, input.userId, HOME_RANGE, input.job, {
      allowAiLayer1Reads: true,
    }),
    getDashboardListenSummary(pool, {
      userId: input.userId,
      range: HOME_RANGE,
      nowMs: priorAnchor,
      topLimit: BRIEFING_TOP_LIMIT,
    }),
    getDashboardListenSummary(pool, {
      userId: input.userId,
      range: HOME_RANGE,
      nowMs: yearAgoAnchor,
      topLimit: BRIEFING_TOP_LIMIT,
    }),
    getDashboardHeroWindowMetrics(pool, {
      userId: input.userId,
      range: HOME_RANGE,
      nowMs: safeAnchor,
      heroCalendar,
    }),
  ]);

  const yearAgoSummary = isPlausibleRollingSevenDayListenSummary(yearAgoSummaryRaw)
    ? yearAgoSummaryRaw
    : null;

  const localHour = calendarHourInTimeZone(safeAnchor, tz);

  let returnAfterGapSentence: string | null = null;
  if (completed.summary.total_scrobbles > 0) {
    const returnAfterGap = await queryBriefingReturnAfterGapInsight(pool, {
      userId: input.userId,
      playedAtLowerInclusive: since,
      playedAtUpperInclusive: new Date(safeAnchor),
      minDominantPlays: 3,
      minGapMs: RETURN_GAP_MS,
    });
    if (returnAfterGap !== null) {
      returnAfterGapSentence = `You came back to ${returnAfterGap.artistName} after about ${returnAfterGap.approxDays} days away from them on this account.`;
    }
  }

  const briefing = buildDashboardHomeBriefing({
    nowMs: safeAnchor,
    displayName: input.displayName,
    summary: completed.summary,
    heroWindow,
    calendarTimeZone: tz,
    priorWeekSummary,
    yearAgoSummary,
    localHour,
    returnAfterGapSentence,
  });

  await upsertHomeBriefingSnapshot(pool, {
    userId: input.userId,
    body: {
      schema_version: 1,
      as_of: new Date(safeAnchor).toISOString(),
      time_zone: tz,
      calendar_ymd: calendarYmd,
      briefing,
    },
  });

  return briefing;
}
