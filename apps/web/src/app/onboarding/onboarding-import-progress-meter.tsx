"use client";

import { useMemo } from "react";
import nothingSegmentStyles from "@/app/home-landing.module.css";
import { formatCount } from "@/app/dashboard/format-count";
import {
  importJobItemsTotalKnown,
  importJobShowsSegmentedProgressBar,
} from "@/app/dashboard/import-job-progress-helpers";

/** Nothing design system segmented bar uses eight columns (`home-landing.module.css`). */
const NOTHING_SEGMENT_COUNT = 8 as const;

export type OnboardingImportProgressMeterProps = Readonly<{
  itemsProcessed: number;
  itemsTotal: number | null;
  importPercent: number | null;
  listenCount: number;
}>;

export function OnboardingImportProgressMeter({
  itemsProcessed,
  itemsTotal,
  importPercent,
  listenCount,
}: OnboardingImportProgressMeterProps) {
  const showDeterminate = importJobShowsSegmentedProgressBar(itemsTotal);
  const totalKnown = importJobItemsTotalKnown(itemsTotal);

  const filledSegments = useMemo(() => {
    if (!showDeterminate || !totalKnown) {
      return 0;
    }
    const ratio = Math.min(1, Math.max(0, itemsProcessed / itemsTotal));
    return Math.min(
      NOTHING_SEGMENT_COUNT,
      Math.max(0, Math.round(ratio * NOTHING_SEGMENT_COUNT)),
    );
  }, [itemsProcessed, itemsTotal, showDeterminate, totalKnown]);

  const caption =
    showDeterminate && totalKnown
      ? `${formatCount(itemsProcessed)} / ${formatCount(itemsTotal)} batches`
      : `${formatCount(listenCount)} listens stored`;

  return (
    <div className={nothingSegmentStyles.progressCluster}>
      <div
        className={nothingSegmentStyles.segmentedBar}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={
          showDeterminate && importPercent !== null ? importPercent : undefined
        }
        aria-busy={!showDeterminate}
        aria-label={showDeterminate ? "Import batch progress" : "Import in progress"}
      >
        {Array.from({ length: NOTHING_SEGMENT_COUNT }, (_, i) => {
          if (showDeterminate) {
            const filled = i < filledSegments;
            return (
              <div
                key={i}
                className={
                  filled
                    ? `${nothingSegmentStyles.segment} ${nothingSegmentStyles.segmentInfo}`
                    : nothingSegmentStyles.segment
                }
              />
            );
          }
          return (
            <div
              key={i}
              className={`${nothingSegmentStyles.segment} ${nothingSegmentStyles.segmentInfo} ${nothingSegmentStyles.segmentWaitPulse}`}
              style={{ animationDelay: `${i * 0.1}s` }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 pt-1 font-mono text-caption uppercase tracking-[0.06em] text-muted">
        <span className="min-w-0">{caption}</span>
        {importPercent !== null ? (
          <span className="shrink-0 tabular-nums text-foreground">{importPercent}%</span>
        ) : (
          <span className="shrink-0 text-[0.7rem] normal-case tracking-normal text-muted">
            Live updates as listens are saved
          </span>
        )}
      </div>
    </div>
  );
}
