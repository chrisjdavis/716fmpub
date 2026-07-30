import { coalesceStatsRollupTimeZoneIANA } from "./statsRollupTimeZone.js";

/** Stable id for Layer1 / evidence consumers (VS-47 TASK 2.2). */
export const LISTENING_TEMPORAL_SIGNAL_METRIC_FAMILY_V1 =
  "716fm.listening_history.temporal_signals.v1" as const;

const DEFAULT_BURST_MAX_INTER_LISTEN_GAP_MS = 90_000 as const;
const DEFAULT_BURST_MIN_PLAYS = 4 as const;

export type ListeningTemporalSignalsInput = Readonly<{
  /**
   * Wall-clock instants from listening history (`played_at` as epoch milliseconds).
   * Order does not matter; non-finite values are ignored.
   */
  playedAtMs: readonly number[];
  /**
   * User stats IANA zone (same column as SQL `users.stats_timezone`); invalid or empty → UTC
   * via {@link coalesceStatsRollupTimeZoneIANA}.
   */
  statsTimezoneIana: string | null | undefined;
  /**
   * Bursts merge consecutive plays whose gaps are ≤ this value (default 90s).
   * Overlapping chains naturally merge into one window.
   */
  burstMaxInterListenGapMs?: number;
  /** A merged chain counts as a burst only when it contains at least this many plays (default 4). */
  burstMinPlays?: number;
}>;

export type ListeningTemporalStreakWindow = Readonly<{
  /** Local civil date `YYYY-MM-DD` in {@link ListeningTemporalSignalsResult.resolved_stats_timezone_iana}. */
  start_local_ymd: string;
  end_local_ymd: string;
  length_days: number;
}>;

export type ListeningTemporalBurstWindow = Readonly<{
  start_played_at_ms: number;
  end_played_at_ms: number;
  play_count: number;
}>;

export type ListeningTemporalSignalsResult = Readonly<{
  metric_family: typeof LISTENING_TEMPORAL_SIGNAL_METRIC_FAMILY_V1;
  /** Zone used for every local-calendar field (coalesced from input). */
  resolved_stats_timezone_iana: string;
  /** Thresholds used to build {@link burst_windows}; always present for snapshot comparability. */
  burst_max_inter_listen_gap_ms_applied: number;
  burst_min_plays_applied: number;
  first_listen_at_ms: number | null;
  last_listen_at_ms: number | null;
  total_play_count: number;
  /** Distinct local civil dates with ≥1 play. */
  active_local_day_count: number;
  /**
   * Total plays divided by active local days; `null` when there are no active days
   * (no fake ratio on empty history).
   */
  mean_plays_per_active_local_day: number | null;
  /** Largest single-day play pile in the resolved local calendar. */
  max_plays_on_single_local_day: number;
  /**
   * False when any distinct `localYmdInZone` label did not match `YYYY-MM-DD`, so consecutive-day
   * logic would be undefined.
   */
  streak_windows_available: boolean;
  /** Every maximal contiguous run of active local days (length ≥ 1), sorted by `start_local_ymd`. */
  streak_windows: readonly ListeningTemporalStreakWindow[];
  longest_streak_length_days: number;
  burst_windows: readonly ListeningTemporalBurstWindow[];
  /**
   * False when `Intl` did not yield a usable 0–23 local hour for every play (no silent hour-0 fill).
   */
  local_hour_distribution_available: boolean;
  /** Index 0 = local hour 0 … index 23 = hour 23; sums to `total_play_count` when available. */
  local_hour_distribution: readonly number[] | null;
  /** Plays where local hour parts were missing or non-numeric. */
  plays_with_invalid_local_hour: number;
  /**
   * False when any play’s local civil `YYYY-MM-DD` from `Intl` did not parse, so PG `dow` parity
   * cannot be attested for the full set.
   */
  weekday_weekend_available: boolean;
  /**
   * When {@link weekday_weekend_available} is true: Mon–Fri vs Sat–Sun in the resolved zone,
   * using pure Gregorian `dow` matching PostgreSQL `extract(dow)` (0 = Sunday … 6 = Saturday).
   * When false: both counts are `null` (no fabricated split).
   */
  weekday_play_count: number | null;
  weekend_play_count: number | null;
  /** Plays skipped for weekday/weekend because the local civil date label was unparseable. */
  plays_with_invalid_local_ymd: number;
}>;

/** Gregorian ordinal day number (integer) for civil `(y,m,d)` — consecutive days differ by 1. */
export function gregorianOrdinalDayNumber(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yAdj = y + 4800 - a;
  const mAdj = m + 12 * a - 3;
  return (
    d +
    Math.floor((153 * mAdj + 2) / 5) +
    365 * yAdj +
    Math.floor(yAdj / 4) -
    Math.floor(yAdj / 100) +
    Math.floor(yAdj / 400) -
    32045
  );
}

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) {
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    return null;
  }
  return { y, m: mo, d };
}

function localYmdInZone(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function localHour0to23OrNull(ms: number, timeZone: string): number | null {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date(ms));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
  return Number.isFinite(h) && h >= 0 && h <= 23 ? h : null;
}

/**
 * PostgreSQL `extract(dow from date)` for Gregorian civil `(y,m,d)`:
 * 0 = Sunday … 6 = Saturday. Pure arithmetic (no locale weekday strings).
 */
export function postgresDowSunday0FromGregorianYmd(y: number, m: number, d: number): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  let yAdj = y;
  if (m < 3) {
    yAdj -= 1;
  }
  const w =
    yAdj +
    Math.floor(yAdj / 4) -
    Math.floor(yAdj / 100) +
    Math.floor(yAdj / 400) +
    t[m - 1]! +
    d;
  return ((w % 7) + 7) % 7;
}

function computeStreakWindows(sortedUniqueYmd: readonly string[]): ListeningTemporalStreakWindow[] {
  if (sortedUniqueYmd.length === 0) {
    return [];
  }
  const windows: ListeningTemporalStreakWindow[] = [];
  let runStart = sortedUniqueYmd[0]!;
  let runEnd = sortedUniqueYmd[0]!;
  let runLen = 1;
  const startOrd = (ymd: string) => {
    const p = parseYmd(ymd);
    return p ? gregorianOrdinalDayNumber(p.y, p.m, p.d) : NaN;
  };
  let prevOrd = startOrd(runEnd);
  for (let i = 1; i < sortedUniqueYmd.length; i += 1) {
    const ymd = sortedUniqueYmd[i]!;
    const ord = startOrd(ymd);
    if (ord === prevOrd + 1) {
      runEnd = ymd;
      runLen += 1;
      prevOrd = ord;
    } else {
      windows.push({ start_local_ymd: runStart, end_local_ymd: runEnd, length_days: runLen });
      runStart = ymd;
      runEnd = ymd;
      runLen = 1;
      prevOrd = ord;
    }
  }
  windows.push({ start_local_ymd: runStart, end_local_ymd: runEnd, length_days: runLen });
  return windows;
}

function computeBurstWindows(
  sortedMs: readonly number[],
  maxGapMs: number,
  minPlays: number,
): ListeningTemporalBurstWindow[] {
  if (sortedMs.length === 0 || minPlays <= 0) {
    return [];
  }
  const bursts: ListeningTemporalBurstWindow[] = [];
  let segStart = 0;
  let segEnd = 0;
  for (let i = 1; i < sortedMs.length; i += 1) {
    const gap = sortedMs[i]! - sortedMs[i - 1]!;
    if (gap <= maxGapMs) {
      segEnd = i;
    } else {
      const len = segEnd - segStart + 1;
      if (len >= minPlays) {
        bursts.push({
          start_played_at_ms: sortedMs[segStart]!,
          end_played_at_ms: sortedMs[segEnd]!,
          play_count: len,
        });
      }
      segStart = i;
      segEnd = i;
    }
  }
  const len = segEnd - segStart + 1;
  if (len >= minPlays) {
    bursts.push({
      start_played_at_ms: sortedMs[segStart]!,
      end_played_at_ms: sortedMs[segEnd]!,
      play_count: len,
    });
  }
  return bursts;
}

/**
 * Deterministic temporal summaries from raw listen timestamps.
 * Local calendar fields use the same IANA resolution rule as SQL `AT TIME ZONE` inputs
 * ({@link coalesceStatsRollupTimeZoneIANA}).
 */
export function computeListeningTemporalSignals(
  input: ListeningTemporalSignalsInput,
): ListeningTemporalSignalsResult {
  const tz = coalesceStatsRollupTimeZoneIANA(input.statsTimezoneIana);
  const maxGap = input.burstMaxInterListenGapMs ?? DEFAULT_BURST_MAX_INTER_LISTEN_GAP_MS;
  const minBurst = input.burstMinPlays ?? DEFAULT_BURST_MIN_PLAYS;

  const finite = input.playedAtMs.filter((x) => Number.isFinite(x)) as number[];
  const sorted = [...finite].sort((a, b) => a - b);
  const n = sorted.length;

  if (n === 0) {
    const zeros = Array.from({ length: 24 }, () => 0) as readonly number[];
    return {
      metric_family: LISTENING_TEMPORAL_SIGNAL_METRIC_FAMILY_V1,
      resolved_stats_timezone_iana: tz,
      burst_max_inter_listen_gap_ms_applied: maxGap,
      burst_min_plays_applied: minBurst,
      first_listen_at_ms: null,
      last_listen_at_ms: null,
      total_play_count: 0,
      active_local_day_count: 0,
      mean_plays_per_active_local_day: null,
      max_plays_on_single_local_day: 0,
      streak_windows_available: true,
      streak_windows: [],
      longest_streak_length_days: 0,
      burst_windows: [],
      local_hour_distribution_available: true,
      local_hour_distribution: zeros,
      plays_with_invalid_local_hour: 0,
      weekday_weekend_available: true,
      weekday_play_count: 0,
      weekend_play_count: 0,
      plays_with_invalid_local_ymd: 0,
    };
  }

  const dayToCount = new Map<string, number>();
  const localHours = Array.from({ length: 24 }, () => 0);
  let weekday = 0;
  let weekend = 0;
  let playsWithInvalidLocalYmd = 0;
  let playsWithInvalidLocalHour = 0;

  for (const ms of sorted) {
    const ymd = localYmdInZone(ms, tz);
    dayToCount.set(ymd, (dayToCount.get(ymd) ?? 0) + 1);
    const civil = parseYmd(ymd);
    if (!civil) {
      playsWithInvalidLocalYmd += 1;
    } else {
      const dow = postgresDowSunday0FromGregorianYmd(civil.y, civil.m, civil.d);
      if (dow === 0 || dow === 6) {
        weekend += 1;
      } else {
        weekday += 1;
      }
    }
    const hh = localHour0to23OrNull(ms, tz);
    if (hh === null) {
      playsWithInvalidLocalHour += 1;
    } else {
      localHours[hh] = (localHours[hh] ?? 0) + 1;
    }
  }

  const uniqueDays = [...dayToCount.keys()].sort();
  const activeDays = uniqueDays.length;
  let maxDay = 0;
  for (const c of dayToCount.values()) {
    if (c > maxDay) {
      maxDay = c;
    }
  }

  const streakKeysParseable = uniqueDays.every((k) => parseYmd(k) !== null);
  const streaks = streakKeysParseable ? computeStreakWindows(uniqueDays) : [];
  const longest = streaks.reduce((m, s) => Math.max(m, s.length_days), 0);
  const bursts = computeBurstWindows(sorted, maxGap, minBurst);

  const weekdayWeekendAvailable = playsWithInvalidLocalYmd === 0;
  const localHourDistributionAvailable = playsWithInvalidLocalHour === 0;

  return {
    metric_family: LISTENING_TEMPORAL_SIGNAL_METRIC_FAMILY_V1,
    resolved_stats_timezone_iana: tz,
    burst_max_inter_listen_gap_ms_applied: maxGap,
    burst_min_plays_applied: minBurst,
    first_listen_at_ms: sorted[0]!,
    last_listen_at_ms: sorted[n - 1]!,
    total_play_count: n,
    active_local_day_count: activeDays,
    mean_plays_per_active_local_day: activeDays > 0 ? n / activeDays : null,
    max_plays_on_single_local_day: maxDay,
    streak_windows_available: streakKeysParseable,
    streak_windows: streaks,
    longest_streak_length_days: longest,
    burst_windows: bursts,
    local_hour_distribution_available: localHourDistributionAvailable,
    local_hour_distribution: localHourDistributionAvailable ? localHours : null,
    plays_with_invalid_local_hour: playsWithInvalidLocalHour,
    weekday_weekend_available: weekdayWeekendAvailable,
    weekday_play_count: weekdayWeekendAvailable ? weekday : null,
    weekend_play_count: weekdayWeekendAvailable ? weekend : null,
    plays_with_invalid_local_ymd: playsWithInvalidLocalYmd,
  };
}
