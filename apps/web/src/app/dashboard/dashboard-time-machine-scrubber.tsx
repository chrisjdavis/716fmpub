"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimeMachineMonthDensityRow, TimeMachineTimelineView } from "@vs/db";
import { DashboardTimeMachineDensityField } from "./dashboard-time-machine-density-field";

function closestTimelineIndex(months: readonly string[], target: string): number {
  if (months.length === 0) {
    return -1;
  }
  let best = 0;
  for (let i = 0; i < months.length; i += 1) {
    if (months[i]! <= target) {
      best = i;
    }
  }
  return best;
}

function formatMonthLabelUtc(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) {
    return yyyymm;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

function spreadYearMarkers(minYear: number, maxYear: number): number[] {
  if (!Number.isFinite(minYear) || !Number.isFinite(maxYear)) {
    return [];
  }
  if (minYear === maxYear) {
    return [minYear];
  }
  const tickCount = Math.min(6, Math.max(2, maxYear - minYear + 1));
  const years: number[] = [];
  for (let i = 0; i < tickCount; i += 1) {
    const y = Math.round(minYear + ((maxYear - minYear) * i) / Math.max(1, tickCount - 1));
    if (years[years.length - 1] !== y) {
      years.push(y);
    }
  }
  return years;
}

const ctaButtonClass =
  "h-9 rounded-md border border-hairline px-3.5 font-mono text-caption uppercase tracking-[0.08em] text-muted motion-safe:transition-[transform,background-color,border-color,color] motion-safe:duration-200 motion-safe:ease-out hover:border-display/25 hover:bg-raised motion-safe:active:scale-[0.98]";

export function DashboardTimeMachineScrubber({
  timeline,
  selectedMonth,
  timelineView,
}: Readonly<{
  timeline: readonly TimeMachineMonthDensityRow[];
  selectedMonth: string;
  timelineView: TimeMachineTimelineView;
}>) {
  const router = useRouter();
  const newMusicTimeline = useMemo(
    () => timeline.filter((r) => r.new_artist_count > 0),
    [timeline],
  );
  const activeTimeline = useMemo(
    () => (timelineView === "new-music" ? newMusicTimeline : timeline),
    [timeline, timelineView, newMusicTimeline],
  );
  const months = useMemo(
    () => activeTimeline.map((r) => r.period_start.slice(0, 7)),
    [activeTimeline],
  );
  const plays = useMemo(() => activeTimeline.map((r) => r.play_count), [activeTimeline]);

  const yearMarkers = useMemo(() => {
    if (months.length === 0) {
      return [];
    }
    const y0 = Number(months[0]!.slice(0, 4));
    const y1 = Number(months[months.length - 1]!.slice(0, 4));
    return spreadYearMarkers(y0, y1);
  }, [months]);

  const selectedInTimeline = months.indexOf(selectedMonth);
  const sliderIndex =
    selectedInTimeline >= 0 ? selectedInTimeline : closestTimelineIndex(months, selectedMonth);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  /** Month we `router.push`‑d for; keeps thumb/density on target until RSC updates `selectedMonth`. */
  const [pendingMonth, setPendingMonth] = useState<string | null>(null);
  const pendingNav = useRef<string | null>(null);
  const debounceNav = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (debounceNav.current !== undefined) {
        window.clearTimeout(debounceNav.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (pendingMonth === null) {
      return;
    }
    if (selectedMonth === pendingMonth) {
      setPendingMonth(null);
      setDragIndex(null);
    }
  }, [selectedMonth, pendingMonth]);

  useEffect(() => {
    const onPop = () => {
      setPendingMonth(null);
      setDragIndex(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigateTo = useCallback(
    (yyyymm: string) => {
      if (pendingNav.current === yyyymm) {
        return;
      }
      pendingNav.current = yyyymm;
      const qs = new URLSearchParams();
      qs.set("month", yyyymm);
      if (timelineView === "new-music") {
        qs.set("view", "new-music");
      }
      router.push(`/dashboard/explore?${qs.toString()}`, { scroll: false });
      window.setTimeout(() => {
        pendingNav.current = null;
      }, 400);
    },
    [router, timelineView],
  );

  const toggleNewMusicView = useCallback(() => {
    if (newMusicTimeline.length === 0) {
      return;
    }
    if (timelineView === "new-music") {
      router.push(`/dashboard/explore?month=${encodeURIComponent(selectedMonth)}`, { scroll: false });
      return;
    }
    const inFiltered = newMusicTimeline.some((r) => r.period_start.slice(0, 7) === selectedMonth);
    const targetMonth = inFiltered
      ? selectedMonth
      : (newMusicTimeline[newMusicTimeline.length - 1]?.period_start.slice(0, 7) ?? selectedMonth);
    router.push(
      `/dashboard/explore?month=${encodeURIComponent(targetMonth)}&view=${encodeURIComponent("new-music")}`,
      { scroll: false },
    );
  }, [newMusicTimeline, router, selectedMonth, timelineView]);

  const scheduleNavigateToIndex = useCallback(
    (idx: number) => {
      const m = months[idx];
      if (m === undefined) {
        return;
      }
      if (debounceNav.current !== undefined) {
        window.clearTimeout(debounceNav.current);
      }
      debounceNav.current = window.setTimeout(() => {
        setPendingMonth(m);
        setDragIndex(null);
        navigateTo(m);
        debounceNav.current = undefined;
      }, 160);
    },
    [months, navigateTo],
  );

  if (months.length === 0) {
    return (
      <div className="rounded-md border border-hairline bg-surface px-4 py-6">
        <p className="font-sans text-body text-muted">
          No monthly timeline yet. Finish your stats foundation import to populate calendar months.
        </p>
      </div>
    );
  }

  const pendingIdx = pendingMonth !== null ? months.indexOf(pendingMonth) : -1;
  const idx =
    dragIndex !== null ? dragIndex : pendingIdx >= 0 ? pendingIdx : sliderIndex;
  const safeIdx = Math.max(0, Math.min(months.length - 1, idx));
  const activeMonth = months[safeIdx] ?? selectedMonth;
  const ariaValueText = `${formatMonthLabelUtc(activeMonth)} — ${safeIdx + 1} of ${months.length}`;
  const selectionCaption = `${formatMonthLabelUtc(activeMonth)} — monthly view`;

  return (
    <div className="flex w-full min-w-0 flex-col gap-0">
      <div className="flex h-9 flex-wrap items-start justify-between gap-3">
        <p className="font-mono text-label font-normal uppercase tracking-[0.24em] text-overline">Timeline</p>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            className={ctaButtonClass}
            onClick={() => {
              const m = months[0];
              if (m !== undefined) {
                setPendingMonth(m);
                setDragIndex(null);
                navigateTo(m);
              }
            }}
          >
            First
          </button>
          <button
            type="button"
            className={ctaButtonClass}
            onClick={() => {
              const m = months[months.length - 1];
              if (m !== undefined) {
                setPendingMonth(m);
                setDragIndex(null);
                navigateTo(m);
              }
            }}
          >
            Latest
          </button>
          <button
            type="button"
            className={`${ctaButtonClass} ${
              timelineView === "new-music"
                ? "border-[rgb(37_99_235)]/50 bg-[rgb(37_99_235)]/[0.14] text-[rgb(37_99_235)]"
                : ""
            } disabled:pointer-events-none disabled:opacity-40`}
            disabled={newMusicTimeline.length === 0}
            aria-pressed={timelineView === "new-music"}
            onClick={() => {
              toggleNewMusicView();
            }}
          >
            New Music
          </button>
        </div>
      </div>

      {yearMarkers.length > 0 ? (
        <div
          className="mt-6 flex h-5 w-full items-center justify-between font-sans text-caption tabular-nums text-muted"
          aria-hidden
        >
          {yearMarkers.map((y) => (
            <span key={y} className="tabular-nums">
              {y}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-3 w-full min-w-0">
        <DashboardTimeMachineDensityField
          plays={plays}
          selectedIndex={safeIdx}
          accentVariant={timelineView === "new-music" ? "newMusic" : "brand"}
        />
      </div>

      <div className="relative mt-4 flex w-full items-center py-1 md:mt-5">
        <label className="sr-only" htmlFor="time-machine-month-slider">
          Select month
        </label>
        <input
          id="time-machine-month-slider"
          type="range"
          className={`time-machine-rail h-[18px] w-full min-w-0 cursor-pointer appearance-none bg-transparent ${
            timelineView === "new-music" ? "time-machine-rail--new-music" : "accent-brand"
          }`}
          min={0}
          max={months.length - 1}
          value={safeIdx}
          aria-valuetext={ariaValueText}
          aria-label="Select month along your listening timeline"
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) {
              return;
            }
            setDragIndex(n);
            scheduleNavigateToIndex(n);
          }}
        />
      </div>

      <p className="mt-2 max-w-[65ch] font-sans text-base leading-relaxed text-muted">{selectionCaption}</p>
    </div>
  );
}
