import { describe, expect, it } from "vitest";
import {
  computeListenHistoryCoverageQuality,
  countUtcCalendarDaysIntersectingWindow,
  listenHistoryWindowDurationMs,
} from "./listeningHistoryCoverageQuality.js";
import type { ListenHistoryWindowMetrics } from "./listeningHistoryCoverageQuality.js";

const MS_DAY = 86_400_000;

function basePrimary(overrides?: Partial<ListenHistoryWindowMetrics>): ListenHistoryWindowMetrics {
  /** UTC midnight-aligned so `countUtcCalendarDaysIntersectingWindow` equals 7 for a 7-day span. */
  const start = Date.UTC(2026, 0, 10, 0, 0, 0);
  const end = start + 7 * MS_DAY;
  return {
    bounds: { startInclusiveMs: start, endExclusiveMs: end },
    grain: "rolling_ms",
    playCount: 40,
    distinctUtcCalendarDaysWithPlays: 5,
    ...overrides,
  };
}

function peerShifted(
  primary: ListenHistoryWindowMetrics,
  deltaMs: number,
  playCount: number,
  distinctDays: number | null,
): ListenHistoryWindowMetrics {
  return {
    bounds: {
      startInclusiveMs: primary.bounds.startInclusiveMs + deltaMs,
      endExclusiveMs: primary.bounds.endExclusiveMs + deltaMs,
    },
    grain: primary.grain,
    playCount,
    distinctUtcCalendarDaysWithPlays: distinctDays,
  };
}

describe("countUtcCalendarDaysIntersectingWindow", () => {
  it("counts a single UTC day for a sub-day range", () => {
    const s = Date.UTC(2026, 3, 1, 10, 0, 0);
    const e = Date.UTC(2026, 3, 1, 20, 0, 0);
    expect(countUtcCalendarDaysIntersectingWindow(s, e)).toBe(1);
  });

  it("counts seven UTC days for a seven-day half-open window aligned to UTC midnight", () => {
    const s = Date.UTC(2026, 0, 1, 0, 0, 0);
    const e = s + 7 * MS_DAY;
    expect(countUtcCalendarDaysIntersectingWindow(s, e)).toBe(7);
  });

  it("returns 0 for empty or inverted ranges", () => {
    expect(countUtcCalendarDaysIntersectingWindow(100, 100)).toBe(0);
    expect(countUtcCalendarDaysIntersectingWindow(200, 100)).toBe(0);
  });

  it("spans an extra UTC day when the range crosses midnight", () => {
    const s = Date.UTC(2026, 0, 5, 22, 0, 0);
    const e = Date.UTC(2026, 0, 6, 2, 0, 0);
    expect(countUtcCalendarDaysIntersectingWindow(s, e)).toBe(2);
  });
});

describe("listenHistoryWindowDurationMs", () => {
  it("returns end minus start", () => {
    expect(
      listenHistoryWindowDurationMs({
        startInclusiveMs: 1000,
        endExclusiveMs: 8000,
      }),
    ).toBe(7000);
  });
});

describe("computeListenHistoryCoverageQuality", () => {
  const catalogThrough = Date.UTC(2026, 0, 20, 0, 0, 0);
  const evalMs = Date.UTC(2026, 0, 20, 0, 0, 0);

  it("marks sparse users when plays are below the comparability floor", () => {
    const primary = basePrimary({ playCount: 2, distinctUtcCalendarDaysWithPlays: 2 });
    const r = computeListenHistoryCoverageQuality({
      primary,
      evaluationAsOfMs: evalMs,
      catalogObservedThroughMs: catalogThrough,
      importPipelineStage: "completed",
      rollupCoverage: null,
      priorWindow: null,
      yearAgoWindow: null,
    });
    expect(r.sparseListening).toBe(true);
    expect(r.insufficiency.codes).toContain("INSUFFICIENT_SAMPLE");
    expect(r.insufficiency.eligibleForDownstreamUse).toBe(false);
    expect(r.comparability.comparableToPriorWindowSameGrain).toBe(false);
    expect(r.comparability.comparableToYearAgoWindowSameGrain).toBe(false);
  });

  it("flags rollup drift as partial coverage", () => {
    const primary = basePrimary();
    const r = computeListenHistoryCoverageQuality({
      primary,
      evaluationAsOfMs: evalMs,
      catalogObservedThroughMs: catalogThrough,
      importPipelineStage: "completed",
      rollupCoverage: {
        distinctListenCalendarMonths: 12,
        periodMetricsMonthsWithPositivePlays: 6,
      },
      priorWindow: null,
      yearAgoWindow: null,
    });
    expect(r.partialImportLikely).toBe(true);
    expect(r.insufficiency.codes).toContain("PARTIAL_COVERAGE");
    expect(r.comparability.comparableToPriorWindowSameGrain).toBe(false);
  });

  it("flags in-flight import stages as partial coverage", () => {
    const primary = basePrimary();
    const r = computeListenHistoryCoverageQuality({
      primary,
      evaluationAsOfMs: evalMs,
      catalogObservedThroughMs: catalogThrough,
      importPipelineStage: "running",
      rollupCoverage: null,
      priorWindow: null,
      yearAgoWindow: null,
    });
    expect(r.partialImportLikely).toBe(true);
    expect(r.insufficiency.codes).toContain("PARTIAL_COVERAGE");
  });

  it("flags stale catalog when observed through is before the window end", () => {
    const primary = basePrimary();
    const r = computeListenHistoryCoverageQuality({
      primary,
      evaluationAsOfMs: evalMs,
      catalogObservedThroughMs: primary.bounds.endExclusiveMs - 2,
      importPipelineStage: "completed",
      rollupCoverage: null,
      priorWindow: null,
      yearAgoWindow: null,
    });
    expect(r.catalogIncompleteForWindow).toBe(true);
    expect(r.catalogCursorMissing).toBe(false);
    expect(r.catalogStaleForPrimaryWindow).toBe(true);
    expect(r.insufficiency.codes).toContain("STALE_SOURCE");
    expect(r.insufficiency.codes).not.toContain("MISSING_SOURCE");
  });

  it("uses MISSING_SOURCE when catalog cursor is omitted, not STALE_SOURCE", () => {
    const primary = basePrimary();
    const r = computeListenHistoryCoverageQuality({
      primary,
      evaluationAsOfMs: evalMs,
      catalogObservedThroughMs: null,
      importPipelineStage: "completed",
      rollupCoverage: null,
      priorWindow: null,
      yearAgoWindow: null,
    });
    expect(r.catalogCursorMissing).toBe(true);
    expect(r.catalogStaleForPrimaryWindow).toBe(false);
    expect(r.catalogIncompleteForWindow).toBe(true);
    expect(r.insufficiency.codes).toContain("MISSING_SOURCE");
    expect(r.insufficiency.codes).not.toContain("STALE_SOURCE");
  });

  it("does not emit day-fill score keys when distinct UTC days are unknown", () => {
    const primary = basePrimary({ distinctUtcCalendarDaysWithPlays: null });
    const r = computeListenHistoryCoverageQuality({
      primary,
      evaluationAsOfMs: evalMs,
      catalogObservedThroughMs: catalogThrough,
      importPipelineStage: "completed",
      rollupCoverage: null,
      priorWindow: null,
      yearAgoWindow: null,
    });
    expect(r.deterministicScores.values.utc_day_coverage_ratio).toBeUndefined();
    expect(r.deterministicScores.values.distinct_utc_calendar_days_with_listens).toBeUndefined();
    expect(r.comparability.comparableToPriorWindowSameGrain).toBe(false);
    expect(r.comparability.comparableToYearAgoWindowSameGrain).toBe(false);
  });

  it("allows prior-window and year-ago comparability when peers are well-formed and strong enough", () => {
    const primary = basePrimary();
    const dur = primary.bounds.endExclusiveMs - primary.bounds.startInclusiveMs;
    const prior = peerShifted(primary, -dur, 30, 5);
    const yearAgo = peerShifted(primary, -365 * MS_DAY, 35, 6);
    const r = computeListenHistoryCoverageQuality({
      primary,
      evaluationAsOfMs: evalMs,
      catalogObservedThroughMs: Math.max(
        catalogThrough,
        primary.bounds.endExclusiveMs,
        prior.bounds.endExclusiveMs,
        yearAgo.bounds.endExclusiveMs,
      ),
      importPipelineStage: "completed",
      rollupCoverage: {
        distinctListenCalendarMonths: 6,
        periodMetricsMonthsWithPositivePlays: 6,
      },
      priorWindow: prior,
      yearAgoWindow: yearAgo,
    });
    expect(r.insufficiency.eligibleForDownstreamUse).toBe(true);
    expect(r.comparability.comparableToPriorWindowSameGrain).toBe(true);
    expect(r.comparability.comparableToYearAgoWindowSameGrain).toBe(true);
    expect(r.deterministicScores.values.utc_day_coverage_ratio).toBeCloseTo(5 / 7);
  });

  it("rejects prior comparability when peer grain differs", () => {
    const primary = basePrimary();
    const dur = primary.bounds.endExclusiveMs - primary.bounds.startInclusiveMs;
    const priorWrongGrain: ListenHistoryWindowMetrics = {
      ...peerShifted(primary, -dur, 40, 5),
      grain: "utc_calendar_month",
    };
    const r = computeListenHistoryCoverageQuality({
      primary,
      evaluationAsOfMs: evalMs,
      catalogObservedThroughMs: catalogThrough,
      importPipelineStage: "completed",
      rollupCoverage: null,
      priorWindow: priorWrongGrain,
      yearAgoWindow: null,
    });
    expect(r.comparability.comparableToPriorWindowSameGrain).toBe(false);
  });

  it("rejects prior comparability when peer duration differs", () => {
    const primary = basePrimary();
    const prior: ListenHistoryWindowMetrics = {
      bounds: {
        startInclusiveMs: primary.bounds.startInclusiveMs - MS_DAY,
        endExclusiveMs: primary.bounds.startInclusiveMs,
      },
      grain: "rolling_ms",
      playCount: 100,
      distinctUtcCalendarDaysWithPlays: 1,
    };
    expect(prior.bounds.endExclusiveMs - prior.bounds.startInclusiveMs).not.toBe(
      primary.bounds.endExclusiveMs - primary.bounds.startInclusiveMs,
    );
    const r = computeListenHistoryCoverageQuality({
      primary,
      evaluationAsOfMs: evalMs,
      catalogObservedThroughMs: catalogThrough,
      importPipelineStage: "completed",
      rollupCoverage: null,
      priorWindow: prior,
      yearAgoWindow: null,
    });
    expect(r.comparability.comparableToPriorWindowSameGrain).toBe(false);
  });

  it("rejects peer comparability when peer plays are sparse even if primary is strong", () => {
    const primary = basePrimary();
    const dur = primary.bounds.endExclusiveMs - primary.bounds.startInclusiveMs;
    const prior = peerShifted(primary, -dur, 2, 2);
    const r = computeListenHistoryCoverageQuality({
      primary,
      evaluationAsOfMs: evalMs,
      catalogObservedThroughMs: Math.max(
        catalogThrough,
        primary.bounds.endExclusiveMs,
        prior.bounds.endExclusiveMs,
      ),
      importPipelineStage: "completed",
      rollupCoverage: null,
      priorWindow: prior,
      yearAgoWindow: null,
    });
    expect(r.comparability.comparableToPriorWindowSameGrain).toBe(false);
  });

  it("flags insufficient sample when plays are high but UTC day spread is too narrow", () => {
    const primary = basePrimary({ playCount: 80, distinctUtcCalendarDaysWithPlays: 1 });
    const r = computeListenHistoryCoverageQuality({
      primary,
      evaluationAsOfMs: evalMs,
      catalogObservedThroughMs: catalogThrough,
      importPipelineStage: "completed",
      rollupCoverage: null,
      priorWindow: null,
      yearAgoWindow: null,
    });
    expect(r.sparseListening).toBe(true);
    expect(r.insufficiency.codes).toContain("INSUFFICIENT_SAMPLE");
  });

  it("emits UNKNOWN_ELIGIBILITY for malformed windows", () => {
    const primary: ListenHistoryWindowMetrics = {
      bounds: { startInclusiveMs: 500, endExclusiveMs: 100 },
      grain: "rolling_ms",
      playCount: 10,
      distinctUtcCalendarDaysWithPlays: 1,
    };
    const r = computeListenHistoryCoverageQuality({
      primary,
      evaluationAsOfMs: evalMs,
      catalogObservedThroughMs: catalogThrough,
      importPipelineStage: "completed",
      rollupCoverage: null,
      priorWindow: null,
      yearAgoWindow: null,
    });
    expect(r.insufficiency.codes).toContain("UNKNOWN_ELIGIBILITY");
    expect(r.sparseListening).toBe(true);
  });
});
