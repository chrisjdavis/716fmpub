import type { ImportPipelineStage } from "./import/pipelineStage.js";
import type { Layer1ComparabilityFlags, Layer1Insufficiency } from "./evidence/layer1EvidenceObject.js";

/** Stable id for downstream rankers / evidence rows (VS-46 TASK 2.1). */
export const LISTENING_HISTORY_COVERAGE_METRIC_FAMILY_V1 =
  "716fm.listening_history.coverage_quality.v1" as const;

const MS_PER_DAY = 86_400_000 as const;

/** Conservative defaults; callers may override via {@link ListenHistoryCoverageQualityOptions}. */
export const DEFAULT_LISTEN_HISTORY_COVERAGE_THRESHOLDS = Object.freeze({
  /** Below this play count (for the evaluated window) counts as sparse for comparisons. */
  minPlaysForComparability: 3,
  /**
   * When {@link ListenHistoryWindowMetrics.distinctUtcCalendarDaysWithPlays} is known and the
   * window spans at least this many UTC days, require at least {@link minDistinctUtcDaysForComparability} active UTC days.
   */
  minUtcDaysSpannedBeforeDayRule: 3,
  minDistinctUtcDaysForComparability: 2,
});

export type ListenHistoryWindowBounds = Readonly<{
  startInclusiveMs: number;
  endExclusiveMs: number;
}>;

export type ListenHistoryWindowGrain = "rolling_ms" | "utc_calendar_week" | "utc_calendar_month";

export type ListenHistoryWindowMetrics = Readonly<{
  bounds: ListenHistoryWindowBounds;
  grain: ListenHistoryWindowGrain;
  playCount: number;
  /**
   * Distinct UTC calendar dates with ≥1 listen in `[start,end)`. When unknown, pass `null`
   * so day-fill signals stay unknown (comparability stays conservative; no fabricated ratios).
   */
  distinctUtcCalendarDaysWithPlays: number | null;
}>;

export type ListenHistoryRollupCoverageObservation = Readonly<{
  distinctListenCalendarMonths: number;
  periodMetricsMonthsWithPositivePlays: number;
}>;

export type ListenHistoryCoverageQualityOptions = Readonly<{
  thresholds?: Partial<typeof DEFAULT_LISTEN_HISTORY_COVERAGE_THRESHOLDS>;
}>;

export type ListenHistoryCoverageQualityResult = Readonly<{
  metricFamily: typeof LISTENING_HISTORY_COVERAGE_METRIC_FAMILY_V1;
  primaryWindowDurationMs: number;
  utcCalendarDaysSpanned: number;
  distinctUtcCalendarDaysWithPlays: number | null;
  /**
   * `distinct / spanned` when distinct is known and spanned > 0; otherwise `null` (no fake precision).
   */
  utcDayCoverageRatio: number | null;
  playCount: number;
  sparseListening: boolean;
  partialImportLikely: boolean;
  /**
   * `catalogObservedThroughMs` was null: caller did not supply a catalog completeness cursor.
   * Insufficiency uses machine token `MISSING_SOURCE`, not `STALE_SOURCE`.
   */
  catalogCursorMissing: boolean;
  /**
   * Cursor was supplied but does not reach the primary window’s exclusive end (known incomplete).
   * Insufficiency may include `STALE_SOURCE`.
   */
  catalogStaleForPrimaryWindow: boolean;
  /**
   * True when the primary window cannot be attested complete from the cursor (`missing || stale`).
   */
  catalogIncompleteForWindow: boolean;
  comparableToPriorWindowSameGrain: boolean;
  comparableToYearAgoWindowSameGrain: boolean;
  insufficiency: Layer1Insufficiency;
  comparability: Pick<
    Layer1ComparabilityFlags,
    | "metricFamily"
    | "comparableWithinUser"
    | "comparableAcrossUsers"
    | "comparableWithinArtistEntity"
    | "comparableAcrossTemporalWindowsOfSameGrain"
    | "comparableToPriorWindowSameGrain"
    | "comparableToYearAgoWindowSameGrain"
  >;
  /**
   * Finite numeric facts only. Day-fill keys appear only when the caller supplied
   * {@link ListenHistoryWindowMetrics.distinctUtcCalendarDaysWithPlays} (never invented).
   */
  deterministicScores: Readonly<{ values: Readonly<Record<string, number>> }>;
}>;

export function listenHistoryWindowDurationMs(bounds: ListenHistoryWindowBounds): number {
  return bounds.endExclusiveMs - bounds.startInclusiveMs;
}

/**
 * Counts UTC calendar dates that intersect `[startInclusiveMs, endExclusiveMs)`.
 * Deterministic: uses floor division on epoch ms (UTC).
 */
export function countUtcCalendarDaysIntersectingWindow(
  startInclusiveMs: number,
  endExclusiveMs: number,
): number {
  if (endExclusiveMs <= startInclusiveMs) {
    return 0;
  }
  const first = Math.floor(startInclusiveMs / MS_PER_DAY);
  const last = Math.floor((endExclusiveMs - 1) / MS_PER_DAY);
  return last - first + 1;
}

function importStageSuggestsInFlightImport(stage: ImportPipelineStage | null): boolean {
  return stage === "queued" || stage === "running";
}

function rollupSuggestsPartialCoverage(obs: ListenHistoryRollupCoverageObservation | null): boolean {
  if (!obs) {
    return false;
  }
  const a = obs.distinctListenCalendarMonths;
  const b = obs.periodMetricsMonthsWithPositivePlays;
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
}

function catalogCoversWindowEnd(
  catalogObservedThroughMs: number | null,
  endExclusiveMs: number,
): boolean {
  if (catalogObservedThroughMs == null) {
    return false;
  }
  return catalogObservedThroughMs >= endExclusiveMs - 1;
}

function thresholdsMerged(
  options?: ListenHistoryCoverageQualityOptions,
): typeof DEFAULT_LISTEN_HISTORY_COVERAGE_THRESHOLDS {
  return {
    ...DEFAULT_LISTEN_HISTORY_COVERAGE_THRESHOLDS,
    ...options?.thresholds,
  };
}

function windowMetricsWellFormed(m: ListenHistoryWindowMetrics): boolean {
  const { startInclusiveMs, endExclusiveMs } = m.bounds;
  if (!Number.isFinite(startInclusiveMs) || !Number.isFinite(endExclusiveMs)) {
    return false;
  }
  if (endExclusiveMs <= startInclusiveMs) {
    return false;
  }
  if (!Number.isFinite(m.playCount) || m.playCount < 0) {
    return false;
  }
  if (m.distinctUtcCalendarDaysWithPlays != null) {
    const d = m.distinctUtcCalendarDaysWithPlays;
    if (!Number.isFinite(d) || !Number.isInteger(d) || d < 0) {
      return false;
    }
  }
  return true;
}

function peerComparableShape(
  primary: ListenHistoryWindowMetrics,
  peer: ListenHistoryWindowMetrics | null,
): boolean {
  if (!peer) {
    return false;
  }
  if (!windowMetricsWellFormed(peer)) {
    return false;
  }
  if (peer.grain !== primary.grain) {
    return false;
  }
  return listenHistoryWindowDurationMs(peer.bounds) === listenHistoryWindowDurationMs(primary.bounds);
}

function meetsComparabilitySampleRules(
  m: ListenHistoryWindowMetrics,
  durationMs: number,
  th: typeof DEFAULT_LISTEN_HISTORY_COVERAGE_THRESHOLDS,
): boolean {
  if (!windowMetricsWellFormed(m)) {
    return false;
  }
  if (m.playCount < th.minPlaysForComparability) {
    return false;
  }
  const spanned = countUtcCalendarDaysIntersectingWindow(
    m.bounds.startInclusiveMs,
    m.bounds.endExclusiveMs,
  );
  if (m.distinctUtcCalendarDaysWithPlays != null) {
    if (spanned >= th.minUtcDaysSpannedBeforeDayRule) {
      if (m.distinctUtcCalendarDaysWithPlays < th.minDistinctUtcDaysForComparability) {
        return false;
      }
    }
  }
  return true;
}

function sparseListening(
  m: ListenHistoryWindowMetrics,
  durationMs: number,
  th: typeof DEFAULT_LISTEN_HISTORY_COVERAGE_THRESHOLDS,
): boolean {
  if (m.playCount === 0) {
    return true;
  }
  if (m.playCount < th.minPlaysForComparability) {
    return true;
  }
  const spanned = countUtcCalendarDaysIntersectingWindow(
    m.bounds.startInclusiveMs,
    m.bounds.endExclusiveMs,
  );
  if (m.distinctUtcCalendarDaysWithPlays != null && spanned >= th.minUtcDaysSpannedBeforeDayRule) {
    if (m.distinctUtcCalendarDaysWithPlays < th.minDistinctUtcDaysForComparability) {
      return true;
    }
  }
  return false;
}

/**
 * Deterministic coverage / quality view for one primary listening window plus optional peers.
 * All facts must be supplied by the caller (DB / workers); this function does not query stores.
 */
export function computeListenHistoryCoverageQuality(
  input: Readonly<{
    primary: ListenHistoryWindowMetrics;
    evaluationAsOfMs: number;
    /**
     * Latest listen-time (or equivalent catalog cursor) the backend trusts through, UTC epoch ms.
     * **`null`** means the observation was **not supplied** → `MISSING_SOURCE` (not `STALE_SOURCE`).
     * When set, must be `>= primary.bounds.endExclusiveMs - 1` to treat the primary window as fully observed.
     */
    catalogObservedThroughMs: number | null;
    importPipelineStage: ImportPipelineStage | null;
    rollupCoverage: ListenHistoryRollupCoverageObservation | null;
    priorWindow: ListenHistoryWindowMetrics | null;
    yearAgoWindow: ListenHistoryWindowMetrics | null;
  }>,
  options?: ListenHistoryCoverageQualityOptions,
): ListenHistoryCoverageQualityResult {
  const th = thresholdsMerged(options);
  const primary = input.primary;
  const durationMs = listenHistoryWindowDurationMs(primary.bounds);
  const utcDaysSpanned = countUtcCalendarDaysIntersectingWindow(
    primary.bounds.startInclusiveMs,
    primary.bounds.endExclusiveMs,
  );

  const primaryOk = windowMetricsWellFormed(primary);
  const catalogCursorMissing = primaryOk && input.catalogObservedThroughMs == null;
  const catalogStaleForPrimaryWindow =
    primaryOk &&
    input.catalogObservedThroughMs != null &&
    !catalogCoversWindowEnd(input.catalogObservedThroughMs, primary.bounds.endExclusiveMs);
  const catalogIncompleteForWindow = catalogCursorMissing || catalogStaleForPrimaryWindow;

  const partialImportLikely =
    importStageSuggestsInFlightImport(input.importPipelineStage) ||
    rollupSuggestsPartialCoverage(input.rollupCoverage);

  const distinctDays = primary.distinctUtcCalendarDaysWithPlays;
  const utcDayCoverageRatio =
    distinctDays != null && utcDaysSpanned > 0 ? distinctDays / utcDaysSpanned : null;

  const sparse = !primaryOk ? true : sparseListening(primary, durationMs, th);

  const codes: string[] = [];
  if (!primaryOk) {
    codes.push("UNKNOWN_ELIGIBILITY");
  } else {
    if (sparse) {
      codes.push("INSUFFICIENT_SAMPLE");
    }
    if (catalogCursorMissing) {
      codes.push("MISSING_SOURCE");
    } else if (catalogStaleForPrimaryWindow) {
      codes.push("STALE_SOURCE");
    }
    if (partialImportLikely) {
      codes.push("PARTIAL_COVERAGE");
    }
  }

  const eligibleForDownstreamUse = primaryOk && codes.length === 0;

  const blockingForTemporalComparisons =
    !primaryOk ||
    sparse ||
    catalogIncompleteForWindow ||
    partialImportLikely ||
    distinctDays == null;

  const priorShapeOk = peerComparableShape(primary, input.priorWindow);
  const yearShapeOk = peerComparableShape(primary, input.yearAgoWindow);

  const priorSampleOk =
    priorShapeOk && input.priorWindow != null
      ? meetsComparabilitySampleRules(input.priorWindow, durationMs, th)
      : false;
  const yearSampleOk =
    yearShapeOk && input.yearAgoWindow != null
      ? meetsComparabilitySampleRules(input.yearAgoWindow, durationMs, th)
      : false;

  const priorCatalogOk =
    priorShapeOk && input.priorWindow != null
      ? catalogCoversWindowEnd(input.catalogObservedThroughMs, input.priorWindow.bounds.endExclusiveMs)
      : false;
  const yearCatalogOk =
    yearShapeOk && input.yearAgoWindow != null
      ? catalogCoversWindowEnd(input.catalogObservedThroughMs, input.yearAgoWindow.bounds.endExclusiveMs)
      : false;

  const comparableToPriorWindowSameGrain =
    !blockingForTemporalComparisons &&
    priorShapeOk &&
    priorSampleOk &&
    priorCatalogOk &&
    meetsComparabilitySampleRules(primary, durationMs, th);

  const comparableToYearAgoWindowSameGrain =
    !blockingForTemporalComparisons &&
    yearShapeOk &&
    yearSampleOk &&
    yearCatalogOk &&
    meetsComparabilitySampleRules(primary, durationMs, th);

  const insufficiency: Layer1Insufficiency = {
    evaluationAsOfMs: input.evaluationAsOfMs,
    eligibleForDownstreamUse,
    codes: eligibleForDownstreamUse ? (["OK"] as const) : [...codes],
    structuredFactors: {
      primary_window_duration_ms: durationMs,
      utc_calendar_days_spanned: utcDaysSpanned,
      distinct_utc_calendar_days_with_listens: distinctDays,
      distinct_utc_days_known: distinctDays != null,
      utc_day_coverage_ratio: utcDayCoverageRatio,
      sparse_listening: sparse,
      partial_import_likely: partialImportLikely,
      catalog_cursor_missing: catalogCursorMissing,
      catalog_stale_for_primary_window: catalogStaleForPrimaryWindow,
      catalog_incomplete_for_primary_window: catalogIncompleteForWindow,
    },
  };

  const comparability = {
    metricFamily: LISTENING_HISTORY_COVERAGE_METRIC_FAMILY_V1,
    comparableWithinUser: eligibleForDownstreamUse,
    comparableAcrossUsers: false,
    comparableWithinArtistEntity: false,
    comparableAcrossTemporalWindowsOfSameGrain:
      comparableToPriorWindowSameGrain || comparableToYearAgoWindowSameGrain,
    comparableToPriorWindowSameGrain,
    comparableToYearAgoWindowSameGrain,
  } as const;

  const scoreValues: Record<string, number> = {
    play_count: primaryOk && Number.isFinite(primary.playCount) ? primary.playCount : 0,
    window_duration_ms: Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0,
    utc_calendar_days_spanned: Number.isFinite(utcDaysSpanned) ? utcDaysSpanned : 0,
  };
  if (distinctDays != null && utcDaysSpanned > 0) {
    scoreValues.distinct_utc_calendar_days_with_listens = distinctDays;
    scoreValues.utc_day_coverage_ratio = distinctDays / utcDaysSpanned;
  }

  return {
    metricFamily: LISTENING_HISTORY_COVERAGE_METRIC_FAMILY_V1,
    primaryWindowDurationMs: Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0,
    utcCalendarDaysSpanned: Number.isFinite(utcDaysSpanned) ? utcDaysSpanned : 0,
    distinctUtcCalendarDaysWithPlays: distinctDays,
    utcDayCoverageRatio,
    playCount: primaryOk && Number.isFinite(primary.playCount) ? primary.playCount : 0,
    sparseListening: sparse,
    partialImportLikely,
    catalogCursorMissing,
    catalogStaleForPrimaryWindow,
    catalogIncompleteForWindow,
    comparableToPriorWindowSameGrain,
    comparableToYearAgoWindowSameGrain,
    insufficiency,
    comparability,
    deterministicScores: { values: scoreValues },
  };
}
