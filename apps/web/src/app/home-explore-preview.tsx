"use client";

import { forwardRef, memo, useEffect, useRef, useState } from "react";

/**
 * Animated illustration of `/dashboard/explore` (musical time machine): month scrubber,
 * synced period header + archive CTA, anchor covers, and insight cards — not live data.
 */
const DENSITY_PX = [
  14, 20, 12, 28, 18, 36, 22, 44, 19, 52, 24, 48, 30, 40, 16, 32, 26, 38, 34, 28, 20, 24, 18, 22, 30,
  26, 32, 20, 16, 24, 28, 22, 35, 40, 18, 26, 30, 22, 20, 28, 24, 32, 36, 20, 18, 26, 30, 22, 28,
  24, 20, 32, 26, 22, 18, 24,
] as const;

const YEAR_MARKERS = ["2017", "2018", "2019", "2020", "2021", "2022"] as const;

const PREVIEW_SLICES = [
  {
    month: "January 2017",
    periodLine: "January 2017 — monthly view",
    narrative:
      "Thin winter plays: a few artists on repeat while the archive warms up.",
  },
  {
    month: "September 2018",
    periodLine: "September 2018 — monthly view",
    narrative: "Commute-heavy month with weekday spikes and quieter weekends (UTC).",
  },
  {
    month: "March 2019",
    periodLine: "March 2019 — monthly view",
    narrative:
      "A concentrated Stereolab month with replay clustering on weekends (UTC).",
  },
  {
    month: "November 2020",
    periodLine: "November 2020 — monthly view",
    narrative: "Home listening stretch: longer sessions, fewer context switches.",
  },
  {
    month: "April 2022",
    periodLine: "April 2022 — monthly view",
    narrative: "Discovery burst: new-to-you tracks mixed with old standbys.",
  },
  {
    month: "December 2022",
    periodLine: "December 2022 — monthly view",
    narrative: "Year-end listening: nostalgia plays plus a few late-night deep dives.",
  },
] as const;

const pillClass =
  "inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-hairline px-3.5 font-mono text-caption uppercase tracking-[0.08em] text-muted";

/** Time the thumb spends traveling between stops (matches CSS transition). */
const MOVE_MS = 700;
/** Pause on each stop after the copy updates, before traveling again. */
const DWELL_MS = 2000;

function progressForSlice(sliceIdx: number): number {
  const max = PREVIEW_SLICES.length - 1;
  return max <= 0 ? 0 : sliceIdx / max;
}

function barIndexForSlice(sliceIdx: number): number {
  return Math.round(progressForSlice(sliceIdx) * (DENSITY_PX.length - 1));
}

/** Next index along the timeline without wrapping 5→0 in one jump (ping-pong). */
function nextSlicePingPong(idx: number, dir: 1 | -1): [number, 1 | -1] {
  const max = PREVIEW_SLICES.length - 1;
  const n = idx + dir;
  if (n > max) return [max - 1, -1];
  if (n < 0) return [1, 1];
  return [n, dir];
}

/** Isolated from slice text updates so transition-driven `left` is not cleared on parent re-render. */
const ExplorePreviewThumb = memo(
  forwardRef<HTMLDivElement>(function ExplorePreviewThumb(_, ref) {
    return (
      <div
        ref={ref}
        className="pointer-events-none absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-canvas bg-brand shadow-sm transition-[left] duration-[700ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ left: `${progressForSlice(2) * 100}%` }}
        aria-hidden
      />
    );
  }),
);

ExplorePreviewThumb.displayName = "ExplorePreviewThumb";

export function HomeExplorePreview() {
  const rootRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [sliceIndex, setSliceIndex] = useState(2);
  const [activeBarIndex, setActiveBarIndex] = useState(() => barIndexForSlice(2));

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyMq = () => setReduceMotion(mq.matches);
    applyMq();
    mq.addEventListener("change", applyMq);
    return () => mq.removeEventListener("change", applyMq);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;

    const root = rootRef.current;
    const thumb = thumbRef.current;
    if (!root || !thumb) return;

    let inView = false;
    const timeouts: number[] = [];
    const tour = { stop: 2, dir: 1 as 1 | -1 };

    const clearTimers = () => {
      for (const id of timeouts) window.clearTimeout(id);
      timeouts.length = 0;
    };

    const schedule = (fn: () => void, ms: number) => {
      timeouts.push(window.setTimeout(fn, ms));
    };

    const syncThumbToStop = (stop: number) => {
      thumb.style.left = `${progressForSlice(stop) * 100}%`;
    };

    const beginTour = () => {
      clearTimers();
      syncThumbToStop(tour.stop);
      setSliceIndex(tour.stop);
      setActiveBarIndex(barIndexForSlice(tour.stop));

      /** After copy updates, wait before the next thumb move. */
      const scheduleNextMoveAfterDwell = () => {
        schedule(() => {
          if (!inView) return;
          runMoveStep();
        }, DWELL_MS);
      };

      /** Move thumb; when motion finishes, update copy, then dwell `DWELL_MS` and repeat. */
      const runMoveStep = () => {
        if (!inView) return;
        const [nextStop, newDir] = nextSlicePingPong(tour.stop, tour.dir);
        tour.dir = newDir;
        const fromP = progressForSlice(tour.stop);
        const toP = progressForSlice(nextStop);
        thumb.style.left = `${fromP * 100}%`;
        void thumb.offsetHeight;
        requestAnimationFrame(() => {
          thumb.style.left = `${toP * 100}%`;
        });
        schedule(() => {
          if (!inView) return;
          tour.stop = nextStop;
          setSliceIndex(nextStop);
          setActiveBarIndex(barIndexForSlice(nextStop));
          scheduleNextMoveAfterDwell();
        }, MOVE_MS);
      };

      /** First paint: show March at stop 2, then same rhythm as later (move → update → 2s → …). */
      schedule(() => {
        if (!inView) return;
        runMoveStep();
      }, DWELL_MS);
    };

    const io = new IntersectionObserver(
      ([e]) => {
        const next = e?.isIntersecting ?? false;
        if (next && !inView) {
          inView = true;
          beginTour();
        } else if (!next) {
          inView = false;
          clearTimers();
        }
      },
      { root: null, rootMargin: "12% 0px 12% 0px", threshold: 0 },
    );
    io.observe(root);

    return () => {
      inView = false;
      clearTimers();
      io.disconnect();
    };
  }, [reduceMotion]);

  const slice = PREVIEW_SLICES[reduceMotion ? 2 : sliceIndex] ?? PREVIEW_SLICES[2];

  return (
    <div
      ref={rootRef}
      data-home-explore-preview
      className="mt-6 w-full rounded-md border border-hairline bg-surface p-5 text-left font-sans md:p-6"
      aria-hidden
    >
      <div className="space-y-5 border-b border-hairline pb-6">
        <p className="font-mono text-label font-normal uppercase tracking-[0.24em] text-overline">
          Explore
        </p>
        <h3 className="font-display text-2xl font-normal leading-tight tracking-tight text-foreground md:text-4xl md:leading-none">
          Your musical time machine
        </h3>
        <p className="max-w-prose font-sans text-base leading-relaxed text-muted md:text-lg">
          Scrub the timeline. Each month reveals a different fingerprint from your history.
        </p>
      </div>

      <div className="mt-6">
        <div className="flex h-9 flex-wrap items-start justify-between gap-3">
          <p className="font-mono text-label font-normal uppercase tracking-[0.24em] text-overline">
            Timeline
          </p>
          <div className="flex flex-wrap gap-2.5">
            <span className={pillClass}>First</span>
            <span className={pillClass}>Latest</span>
          </div>
        </div>

        <div
          className="mt-6 flex h-5 w-full items-center justify-between font-sans text-caption tabular-nums text-muted"
          aria-hidden
        >
          {YEAR_MARKERS.map((y) => (
            <span key={y} className="tabular-nums">
              {y}
            </span>
          ))}
        </div>

        <div className="mt-3 flex h-24 items-end gap-px border-b border-hairline pb-1">
          {DENSITY_PX.map((h, i) => (
            <div
              key={i}
              className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-end transition-[opacity,filter] duration-200 ease-out"
              style={{
                opacity: i === activeBarIndex ? 1 : 0.35,
                filter: i === activeBarIndex ? "none" : "saturate(0.65)",
              }}
            >
              <div
                className={`w-px transition-colors duration-200 ${
                  i === activeBarIndex ? "bg-brand" : "bg-brand/80"
                }`}
                style={{ height: `${h}px` }}
              />
            </div>
          ))}
        </div>

        <div className="relative mt-4 px-2 py-1 md:mt-5">
          <div
            className="h-2 w-full rounded-full border border-hairline bg-raised"
            aria-hidden
          />
          <ExplorePreviewThumb ref={thumbRef} />
        </div>

        <p
          key={slice.periodLine}
          className="mt-2 max-w-[65ch] animate-home-explore-slice-in font-sans text-base leading-relaxed text-muted"
        >
          {slice.periodLine}
        </p>
      </div>

      <div className="mt-8 space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <h3
            key={slice.month}
            className="min-w-0 flex-1 animate-home-explore-slice-in font-display text-3xl font-normal leading-none tracking-tight text-foreground md:text-4xl md:leading-tight"
          >
            {slice.month}
          </h3>
          <span className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-brand bg-brand px-4 font-sans text-base font-medium text-neutral-950">
            Open this month in archive
          </span>
        </div>
        <p
          key={slice.narrative}
          className="max-w-[65ch] animate-home-explore-slice-in font-sans text-xl font-normal leading-snug text-foreground md:text-[1.75rem] md:leading-10"
        >
          {slice.narrative}
        </p>
      </div>

      <p className="mt-6 border-t border-hairline pt-4 font-mono text-caption uppercase tracking-[0.06em] text-muted">
        Illustrative layout — Explore matches your archive after import.
      </p>
    </div>
  );
}
