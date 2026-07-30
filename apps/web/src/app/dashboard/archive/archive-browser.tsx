"use client";

import type {
  ArchiveListenSourceFilter,
  ArchiveListenTypeFilter,
  DashboardAnalyticsRange,
  DashboardArchiveListen,
  DashboardListenSummary,
  DashboardTopAlbum,
  DashboardTopArtist,
  DashboardTopTrack,
} from "@vs/db";
import { useWindowVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { sanitizeUserFacingPlainText } from "@vs/domain/user-facing-plain-text";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { displayLabel } from "../dashboard-display-label";
import { DashboardCoverThumb } from "../dashboard-cover-thumb";
import { formatCount } from "../format-count";
import { useDashboardDisplayIanaTimeZone } from "../dashboard-display-timezone-context";
import { formatDashboardTimestamp } from "../format-dashboard-timestamp";
import { DashboardListeningInsightsAdvancedGate } from "../dashboard-listening-insights-advanced-gate";
import {
  ARCHIVE_LIST_VIRTUAL_OVERSCAN,
  ARCHIVE_LIST_VIRTUAL_PADDING_END,
} from "./archive-virtual-dom-budget";
import {
  buildArchiveVirtualRows,
  estimateArchiveVirtualRowHeight,
  type ArchiveVirtualRow,
} from "./archive-flat-rows";
import styles from "./archive-page.module.css";

function monthLabelUtc(key: string): string {
  const [ys, ms] = key.split("-");
  const d = new Date(Date.UTC(Number(ys), Number(ms) - 1, 1));
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(d)
    .toUpperCase();
}

function sourceLabel(s: DashboardArchiveListen["listen_source"]): string {
  return s === "import" ? "IMPORT" : "LAST.FM";
}

function rangeTokenLabel(r: DashboardAnalyticsRange): string {
  switch (r) {
    case "7d":
      return "LAST 7 DAYS";
    case "30d":
      return "LAST 30 DAYS";
    case "90d":
      return "LAST 90 DAYS";
    default:
      return "ALL TIME";
  }
}

function typeTokenLabel(t: ArchiveListenTypeFilter): string {
  switch (t) {
    case "artists":
      return "ARTISTS";
    case "albums":
      return "ALBUMS";
    default:
      return "TRACKS";
  }
}

function sourceTokenLabel(s: ArchiveListenSourceFilter): string {
  switch (s) {
    case "lastfm":
      return "LAST.FM";
    case "import":
      return "IMPORT";
    case "spotify":
      return "SPOTIFY";
    default:
      return "";
  }
}

function firstListenUtcStartYear(iso: string | null): number | null {
  if (!iso) return null;
  const y = new Date(iso).getUTCFullYear();
  if (!Number.isFinite(y)) return null;
  return y;
}

type ArchiveHighlightAlbum = Readonly<{
  title: string;
  artistName: string;
  plays: number;
  musicbrainz_release_mbid: string | null;
  lastfm_cover_image_url: string | null;
}>;

type ArchiveHighlightArtist = Readonly<{
  name: string;
  plays: number;
  musicbrainz_release_mbid: string | null;
  lastfm_cover_image_url: string | null;
}>;

function normalizeHighlightArtistKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function inferHighlightArtistCover(
  topArtist: DashboardTopArtist | null,
  topAlbum: DashboardTopAlbum | null,
  topTracks: readonly DashboardTopTrack[],
): { musicbrainz_release_mbid: string | null; lastfm_cover_image_url: string | null } | null {
  if (!topArtist) {
    return null;
  }
  const key = normalizeHighlightArtistKey(topArtist.name);
  for (const t of topTracks) {
    if (normalizeHighlightArtistKey(t.artist_name) !== key) {
      continue;
    }
    if (t.musicbrainz_release_mbid || t.lastfm_cover_image_url) {
      return {
        musicbrainz_release_mbid: t.musicbrainz_release_mbid,
        lastfm_cover_image_url: t.lastfm_cover_image_url,
      };
    }
  }
  if (
    topAlbum &&
    normalizeHighlightArtistKey(topAlbum.artist_name) === key &&
    (topAlbum.musicbrainz_release_mbid || topAlbum.lastfm_cover_image_url)
  ) {
    return {
      musicbrainz_release_mbid: topAlbum.musicbrainz_release_mbid,
      lastfm_cover_image_url: topAlbum.lastfm_cover_image_url,
    };
  }
  return null;
}

function archiveHighlightsFromListenSummary(summary: DashboardListenSummary): {
  album: ArchiveHighlightAlbum | null;
  artist: ArchiveHighlightArtist | null;
} {
  const topArtist = summary.top_artists[0] ?? null;
  const topAlbum = summary.top_albums[0] ?? null;
  const cover = inferHighlightArtistCover(topArtist, topAlbum, summary.top_tracks);
  return {
    album: topAlbum
      ? {
          title: topAlbum.title,
          artistName: topAlbum.artist_name,
          plays: topAlbum.plays,
          musicbrainz_release_mbid: topAlbum.musicbrainz_release_mbid,
          lastfm_cover_image_url: topAlbum.lastfm_cover_image_url,
        }
      : null,
    artist: topArtist
      ? {
          name: topArtist.name,
          plays: topArtist.plays,
          musicbrainz_release_mbid: cover?.musicbrainz_release_mbid ?? null,
          lastfm_cover_image_url: cover?.lastfm_cover_image_url ?? null,
        }
      : null,
  };
}

function archiveHighlightWindowKey(
  r: DashboardAnalyticsRange,
  utcMonthYyyMm: string | null,
): string {
  return utcMonthYyyMm ? `m:${utcMonthYyyMm}` : `r:${r}`;
}

/** `pref[i]` = listen rows in `rows[0..i-1]`; `pref[i+1]` = listens through row `i` inclusive. */
function buildArchiveListenRankPrefix(rows: readonly ArchiveVirtualRow[]): Uint32Array {
  const pref = new Uint32Array(rows.length + 1);
  for (let i = 0; i < rows.length; i++) {
    pref[i + 1] = pref[i] + (rows[i]!.type === "listen" ? 1 : 0);
  }
  return pref;
}

function playRankBoundsForVirtualRange(
  rows: readonly ArchiveVirtualRow[],
  pref: Uint32Array,
  lead: number,
  trail: number,
): { lo: number; hi: number } | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = -1;
  for (let idx = lead; idx <= trail; idx++) {
    if (rows[idx]?.type === "listen") {
      const rank = pref[idx]! + 1;
      if (rank < lo) lo = rank;
      if (rank > hi) hi = rank;
    }
  }
  return hi >= 0 ? { lo, hi } : null;
}

function buildArchiveQuery(
  range: DashboardAnalyticsRange,
  source: ArchiveListenSourceFilter,
  type: ArchiveListenTypeFilter,
  q: string,
  limit: number,
  cursor: { played_at: string; listen_id: string } | null,
  utcArchiveMonthYyyMm: string | null,
): string {
  const p = new URLSearchParams();
  p.set("range", range);
  p.set("source", source);
  p.set("type", type);
  p.set("limit", String(limit));
  const trimmed = q.trim();
  if (trimmed !== "") {
    p.set("q", trimmed);
  }
  if (cursor) {
    p.set("after_played_at", cursor.played_at);
    p.set("after_listen_id", cursor.listen_id);
  }
  if (utcArchiveMonthYyyMm !== null && utcArchiveMonthYyyMm.trim() !== "") {
    p.set("month", utcArchiveMonthYyyMm);
  }
  return p.toString();
}

function ArchiveVirtualRowView({
  row,
  virtualIndex,
  displayTimeZone,
}: Readonly<{
  row: ArchiveVirtualRow;
  virtualIndex: number;
  displayTimeZone: string;
}>) {
  if (row.type === "month") {
    return (
      <div
        className={
          virtualIndex > 0
            ? `${styles.monthHeading} ${styles.virtualMonthSectionGap}`
            : styles.monthHeading
        }
      >
        <h2 className={styles.monthLabel} id={`archive-month-${row.monthKey}`}>
          {monthLabelUtc(row.monthKey)}
        </h2>
      </div>
    );
  }
  if (row.type === "load-sentinel") {
    return <div className={styles.loadSentinel} aria-hidden />;
  }
  const listenRow = row.listen;
  return (
    <article
      className={`${styles.row} ${styles.rowInteractive} ${styles.virtualRowLayer} hover:bg-raised/50`}
    >
      <div className={styles.rowArt}>
        <DashboardCoverThumb
          musicbrainzReleaseMbid={listenRow.musicbrainz_release_mbid}
          lastfmCoverImageUrl={listenRow.lastfm_cover_image_url}
          alt={displayLabel(listenRow.track_title, "Track")}
          rowSize="sm"
        />
      </div>
      <div className={styles.rowGap} aria-hidden />
      <div className={styles.rowMain}>
        <p className={styles.trackTitle}>{displayLabel(listenRow.track_title, "[UNKNOWN TRACK]")}</p>
        <p className={styles.metaLine}>
          {displayLabel(listenRow.artist_name, "[UNKNOWN ARTIST]")}
          {listenRow.album_title ? ` · ${displayLabel(listenRow.album_title, "[UNKNOWN ALBUM]")}` : ""}
        </p>
      </div>
      <div className={styles.rowSource}>{sourceLabel(listenRow.listen_source)}</div>
      <time className={styles.rowTime} dateTime={listenRow.played_at}>
        {formatDashboardTimestamp(listenRow.played_at, displayTimeZone)}
      </time>
    </article>
  );
}

export function ArchiveBrowser({
  allowAiLayer1Reads,
  deferredInitialList = false,
  initialListens,
  initialHasMore,
  totalPlays,
  initialTapeWindowTotalScrobbles,
  firstListenAt,
  initialHighlightAlbum = null,
  initialHighlightArtist = null,
  initialPageSize,
  initialUtcArchiveMonthYyyMm = null,
  initialAnalyticsRange = "all",
  analyticsApiBase = "/api/analytics",
}: Readonly<{
  /** When false, window totals still load; full listen summary (highlights) stays server-gated. */
  allowAiLayer1Reads: boolean;
  /**
   * When true, the server omitted the first keyset page; this component loads it immediately via
   * `/api/analytics/archive-listens` so the shell (header, filters, strip) can render first.
   */
  deferredInitialList?: boolean;
  initialListens: DashboardArchiveListen[];
  initialHasMore: boolean;
  totalPlays: number;
  /** Total plays in the current analytics window (range or UTC month); tape head uses this as the catalog size. */
  initialTapeWindowTotalScrobbles: number;
  firstListenAt: string | null;
  initialHighlightAlbum?: ArchiveHighlightAlbum | null;
  initialHighlightArtist?: ArchiveHighlightArtist | null;
  initialPageSize: number;
  /** UTC `YYYY-MM` from Stats time machine deep link; keeps archive rows in that calendar month. */
  initialUtcArchiveMonthYyyMm?: string | null;
  /** From `?range=` on first load; rolling window for archive listens (SSR list is still all-time). */
  initialAnalyticsRange?: DashboardAnalyticsRange;
  /** Base path for archive analytics GETs (`/api/analytics` or `/api/public/analytics`). */
  analyticsApiBase?: string;
}>) {
  const displayTimeZone = useDashboardDisplayIanaTimeZone();
  const [utcMonthFilter, setUtcMonthFilter] = useState<string | null>(initialUtcArchiveMonthYyyMm);
  const [range, setRange] = useState<DashboardAnalyticsRange>(initialAnalyticsRange);
  const [tapeWindowTotalPlays, setTapeWindowTotalPlays] = useState(initialTapeWindowTotalScrobbles);
  useEffect(() => {
    setTapeWindowTotalPlays(initialTapeWindowTotalScrobbles);
  }, [initialTapeWindowTotalScrobbles]);
  const [highlightAlbum, setHighlightAlbum] = useState<ArchiveHighlightAlbum | null>(
    initialHighlightAlbum,
  );
  const [highlightArtist, setHighlightArtist] = useState<ArchiveHighlightArtist | null>(
    initialHighlightArtist,
  );
  const [source, setSource] = useState<ArchiveListenSourceFilter>("all");
  const [typeFilter, setTypeFilter] = useState<ArchiveListenTypeFilter>("tracks");
  const [qInput, setQInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  const [listens, setListens] = useState<DashboardArchiveListen[]>(initialListens);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingRefresh, setLoadingRefresh] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Bumped after each successful filter-driven page load so `.archiveListMount` can replay enter motion. */
  const [listSurfaceKey, setListSurfaceKey] = useState(0);
  /** Whether the in-flight refresh started while the list still had rows (for loading copy). */
  const [refreshHadRows, setRefreshHadRows] = useState(false);

  /**
   * Skip the first filter-driven refetch when SSR already supplied rows (not deferred) and the
   * client’s initial filters match that payload (all-time list, no rolling range).
   */
  const skipFilterEffect = useRef(
    !deferredInitialList &&
      initialListens.length > 0 &&
      initialAnalyticsRange === "all",
  );
  const listensLengthRef = useRef(listens.length);
  listensLengthRef.current = listens.length;

  const loadedHighlightKeyRef = useRef(
    archiveHighlightWindowKey(initialAnalyticsRange, initialUtcArchiveMonthYyyMm ?? null),
  );

  useEffect(() => {
    const key = archiveHighlightWindowKey(range, utcMonthFilter);
    if (key === loadedHighlightKeyRef.current) {
      return;
    }
    let cancelled = false;
    const countUrl = utcMonthFilter
      ? `${analyticsApiBase}/window-total?month=${encodeURIComponent(utcMonthFilter)}`
      : `${analyticsApiBase}/window-total?range=${encodeURIComponent(range)}`;
    void (async () => {
      try {
        const countRes = await fetch(countUrl, { method: "GET", credentials: "same-origin" });
        if (countRes.ok && !cancelled) {
          const countBody = (await countRes.json()) as { total_scrobbles: number };
          setTapeWindowTotalPlays(countBody.total_scrobbles);
        }
        if (!allowAiLayer1Reads) {
          if (!cancelled) {
            loadedHighlightKeyRef.current = key;
            setHighlightAlbum(null);
            setHighlightArtist(null);
          }
          return;
        }
        const summaryUrl = utcMonthFilter
          ? `${analyticsApiBase}/summary?month=${encodeURIComponent(utcMonthFilter)}`
          : `${analyticsApiBase}/summary?range=${encodeURIComponent(range)}`;
        const res = await fetch(summaryUrl, { method: "GET", credentials: "same-origin" });
        if (!res.ok) {
          return;
        }
        const body = (await res.json()) as { summary: DashboardListenSummary };
        const mapped = archiveHighlightsFromListenSummary(body.summary);
        if (!cancelled) {
          loadedHighlightKeyRef.current = key;
          setHighlightAlbum(mapped.album);
          setHighlightArtist(mapped.artist);
        }
      } catch {
        /* keep existing highlights */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range, utcMonthFilter, allowAiLayer1Reads, analyticsApiBase]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(qInput), 300);
    return () => window.clearTimeout(t);
  }, [qInput]);

  const fetchPage = useCallback(
    async (opts: {
      append: boolean;
      cursor: { played_at: string; listen_id: string } | null;
    }): Promise<void> => {
      const effectiveRange = utcMonthFilter ? "all" : range;
      const qs = buildArchiveQuery(
        effectiveRange,
        source,
        typeFilter,
        debouncedQ,
        initialPageSize,
        opts.cursor,
        utcMonthFilter,
      );
      const res = await fetch(`${analyticsApiBase}/archive-listens?${qs}`, {
        method: "GET",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errBody?.error ?? `Request failed (${res.status})`);
      }
      const body = (await res.json()) as {
        listens: DashboardArchiveListen[];
        has_more: boolean;
      };
      if (opts.append) {
        setListens((prev) => [...prev, ...body.listens]);
      } else {
        setListens(body.listens);
      }
      setHasMore(body.has_more);
      setLoadError(null);
    },
    [range, source, typeFilter, debouncedQ, initialPageSize, utcMonthFilter, analyticsApiBase],
  );

  useEffect(() => {
    if (skipFilterEffect.current) {
      skipFilterEffect.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      setRefreshHadRows(listensLengthRef.current > 0);
      setLoadingRefresh(true);
      try {
        await fetchPage({ append: false, cursor: null });
        if (!cancelled) {
          setListSurfaceKey((k) => k + 1);
        }
      } catch (e) {
        if (!cancelled) {
          const raw = e instanceof Error ? e.message : "Could not load archive.";
          setLoadError(sanitizeUserFacingPlainText(raw));
        }
      } finally {
        if (!cancelled) {
          setLoadingRefresh(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  const loadMoreInFlightRef = useRef(false);
  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loadingRefresh || loadMoreInFlightRef.current) return;
    const last = listens[listens.length - 1];
    if (!last) return;
    loadMoreInFlightRef.current = true;
    setLoadingMore(true);
    try {
      await fetchPage({
        append: true,
        cursor: { played_at: last.played_at, listen_id: last.listen_id },
      });
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Could not load more.";
      setLoadError(sanitizeUserFacingPlainText(raw));
    } finally {
      loadMoreInFlightRef.current = false;
      setLoadingMore(false);
    }
  }, [fetchPage, hasMore, listens, loadingMore, loadingRefresh]);

  const flatRows = useMemo(() => buildArchiveVirtualRows(listens, hasMore), [listens, hasMore]);
  const listenPrefix = useMemo(() => buildArchiveListenRankPrefix(flatRows), [flatRows]);

  const flatRowsRef = useRef(flatRows);
  flatRowsRef.current = flatRows;
  const listenPrefixRef = useRef(listenPrefix);
  listenPrefixRef.current = listenPrefix;
  const tapeWindowTotalPlaysRef = useRef(tapeWindowTotalPlays);
  tapeWindowTotalPlaysRef.current = tapeWindowTotalPlays;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const loadingMoreRef = useRef(loadingMore);
  loadingMoreRef.current = loadingMore;
  const loadingRefreshRef = useRef(loadingRefresh);
  loadingRefreshRef.current = loadingRefresh;
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  const virtualScrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const controlBarRef = useRef<HTMLDivElement | null>(null);
  const tapeFillRef = useRef<HTMLDivElement | null>(null);
  const tapeSpanRef = useRef<HTMLSpanElement | null>(null);
  const tapePctRef = useRef<HTMLSpanElement | null>(null);
  const tapeRafRef = useRef<number | null>(null);
  const tapeSigRef = useRef({ playLo: -1, playHi: -1, windowT: -1, pct: -1 });
  const virtualizerRef = useRef<Virtualizer<Window, Element> | null>(null);
  const scheduleArchiveTapeRef = useRef<() => void>(() => {});
  const [scrollMargin, setScrollMargin] = useState(0);

  const updateScrollMargin = useCallback(() => {
    const el = virtualScrollAnchorRef.current;
    if (!el || typeof window === "undefined") return;
    setScrollMargin(Math.round(el.getBoundingClientRect().top + window.scrollY));
  }, []);

  const showActiveBar =
    range !== "all" ||
    source !== "all" ||
    typeFilter !== "tracks" ||
    debouncedQ.trim() !== "" ||
    utcMonthFilter !== null;

  useLayoutEffect(() => {
    updateScrollMargin();
    const el = virtualScrollAnchorRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => updateScrollMargin());
    ro.observe(el);
    window.addEventListener("resize", updateScrollMargin);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateScrollMargin);
    };
  }, [updateScrollMargin, showActiveBar, loadError, loadingRefresh, listens.length]);

  const handleVirtualizerChange = useCallback((instance: Virtualizer<Window, Element>) => {
    const r = instance.range;
    const rows = flatRowsRef.current;
    if (!r || rows.length === 0) return;
    const tail = rows[rows.length - 1];
    if (tail?.type !== "load-sentinel") return;
    if (r.endIndex < rows.length - 1) return;
    if (!hasMoreRef.current || loadingMoreRef.current || loadingRefreshRef.current) return;
    void loadMoreRef.current();
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: flatRows.length,
    scrollMargin,
    estimateSize: (index) => estimateArchiveVirtualRowHeight(flatRows[index]),
    overscan: ARCHIVE_LIST_VIRTUAL_OVERSCAN,
    paddingEnd: ARCHIVE_LIST_VIRTUAL_PADDING_END,
    getItemKey: (index) => flatRows[index]?.rowKey ?? `i:${index}`,
    onChange: (instance) => {
      handleVirtualizerChange(instance);
      scheduleArchiveTapeRef.current();
    },
  });

  virtualizerRef.current = virtualizer;

  const syncArchiveTape = useCallback(() => {
    const fill = tapeFillRef.current;
    const span = tapeSpanRef.current;
    const pctEl = tapePctRef.current;
    if (!fill || !span || !pctEl) return;
    if (typeof window === "undefined") return;

    const vz = virtualizerRef.current;
    if (!vz) return;

    const rows = flatRowsRef.current;
    const pref = listenPrefixRef.current;
    if (rows.length === 0 || pref.length !== rows.length + 1) {
      fill.style.transform = "scaleX(0)";
      span.textContent = "—";
      pctEl.textContent = "";
      return;
    }

    const loadedListenCount = pref[rows.length]!;
    const windowT = Math.max(
      1,
      tapeWindowTotalPlaysRef.current > 0 ? tapeWindowTotalPlaysRef.current : loadedListenCount,
    );

    const vis = vz.getVirtualItems();
    if (vis.length === 0) {
      fill.style.transform = "scaleX(0)";
      span.textContent = `PLAYS — / ${formatCount(windowT)}`;
      pctEl.textContent = "0%";
      return;
    }

    const lead = vis[0].index;
    const trail = vis[vis.length - 1].index;
    const centerIdx = Math.min(rows.length - 1, Math.max(0, Math.floor((lead + trail) / 2)));
    const listensThru = pref[centerIdx + 1]!;

    let progress: number;
    if (windowT <= 1) {
      progress = 1;
    } else if (listensThru <= 0) {
      progress = 0;
    } else {
      progress = (listensThru - 1) / (windowT - 1);
      if (progress < 0) progress = 0;
      else if (progress > 1) progress = 1;
    }

    const pct = Math.round(progress * 100);
    fill.style.transform = `scaleX(${progress})`;

    const rankBounds = playRankBoundsForVirtualRange(rows, pref, lead, trail);
    const padW = Math.max(4, String(windowT).length);
    const padRank = (n: number) => String(n).padStart(padW, "0");
    const spanText =
      rankBounds !== null
        ? `PLAYS ${padRank(rankBounds.lo)}–${padRank(rankBounds.hi)} / ${formatCount(windowT)}`
        : `PLAYS — / ${formatCount(windowT)}`;

    const sig = tapeSigRef.current;
    const nextLo = rankBounds?.lo ?? -1;
    const nextHi = rankBounds?.hi ?? -1;
    if (sig.playLo !== nextLo || sig.playHi !== nextHi || sig.windowT !== windowT || sig.pct !== pct) {
      sig.playLo = nextLo;
      sig.playHi = nextHi;
      sig.windowT = windowT;
      sig.pct = pct;
      span.textContent = spanText;
      pctEl.textContent = `${pct}%`;
    }
  }, []);

  const scheduleArchiveTape = useCallback(() => {
    if (typeof window === "undefined") return;
    if (tapeRafRef.current !== null) return;
    tapeRafRef.current = window.requestAnimationFrame(() => {
      tapeRafRef.current = null;
      syncArchiveTape();
    });
  }, [syncArchiveTape]);

  scheduleArchiveTapeRef.current = scheduleArchiveTape;

  useLayoutEffect(() => {
    virtualizer.measure();
  }, [scrollMargin, virtualizer]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onScroll = () => {
      scheduleArchiveTape();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    scheduleArchiveTape();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [scheduleArchiveTape]);

  useLayoutEffect(() => {
    scheduleArchiveTape();
  }, [
    scheduleArchiveTape,
    flatRows.length,
    listenPrefix,
    tapeWindowTotalPlays,
    scrollMargin,
    loadingRefresh,
    listens.length,
    listSurfaceKey,
  ]);

  const prevLoadingRefreshRef = useRef(false);
  useEffect(() => {
    if (loadingRefresh && !prevLoadingRefreshRef.current) {
      const el = controlBarRef.current;
      if (el && typeof window !== "undefined") {
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          const cls = styles.controlBarSettle;
          el.classList.remove(cls);
          void el.offsetWidth;
          el.classList.add(cls);
          window.setTimeout(() => {
            el.classList.remove(cls);
          }, 400);
        }
      }
    }
    prevLoadingRefreshRef.current = loadingRefresh;
  }, [loadingRefresh]);

  const activeBarText = useMemo(() => {
    const parts: string[] = [];
    if (utcMonthFilter) {
      parts.push(`UTC month ${utcMonthFilter}`);
    }
    if (range !== "all") parts.push(rangeTokenLabel(range));
    if (source !== "all") parts.push(sourceTokenLabel(source));
    if (typeFilter !== "tracks") parts.push(typeTokenLabel(typeFilter));
    if (debouncedQ.trim() !== "") {
      parts.push(`“${sanitizeUserFacingPlainText(debouncedQ.trim())}”`);
    }
    return parts.join(" · ");
  }, [utcMonthFilter, range, source, typeFilter, debouncedQ]);

  const archiveSupportingText = useMemo(() => {
    const playsPart = `${formatCount(totalPlays)} play${totalPlays === 1 ? "" : "s"}`;
    const startYear = firstListenUtcStartYear(firstListenAt);
    if (startYear !== null) {
      return `A complete record of everything you've played since ${startYear} (${playsPart}).`;
    }
    return `A complete record of everything you've played (${playsPart}).`;
  }, [totalPlays, firstListenAt]);

  return (
    <div className={styles.outer}>
      <div className={styles.inner}>
        <div className={styles.archiveAboveList}>
        <header className={styles.pageHeader}>
          <div className="flex w-full min-w-0 flex-col items-start gap-4">
            <p className="font-mono text-label uppercase tracking-[0.1em] text-overline">ARCHIVE</p>
            <div className={styles.headlineTrack}>
              <h1 className={styles.headline}>Your indexed library</h1>
            </div>
          </div>
          <p className={styles.supporting}>{archiveSupportingText}</p>
        </header>

        {utcMonthFilter ? (
          <div className={styles.monthFilterCallout}>
            <p className="font-mono text-caption uppercase tracking-[0.06em] text-muted">
              Filtered to {monthLabelUtc(`${utcMonthFilter}-01`)} (UTC)
            </p>
            <button
              type="button"
              className={`rounded-md border border-hairline px-3 py-1.5 font-mono text-caption uppercase tracking-[0.06em] text-muted hover:bg-raised ${styles.monthFilterClear}`}
              onClick={() => setUtcMonthFilter(null)}
            >
              Clear month
            </button>
          </div>
        ) : null}

        <div ref={controlBarRef} className={styles.controlBar}>
          <div className={`${styles.field} ${styles.searchFieldWrap}`}>
            <label className={styles.fieldLabel} htmlFor="archive-search-q">
              Search
            </label>
            <input
              id="archive-search-q"
              type="search"
              className={styles.searchField}
              placeholder="Tracks, artists, albums"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className={styles.filterCluster}>
            <div className={styles.field}>
              <span className={styles.fieldLabel} id="archive-filter-range">
                Time range
              </span>
              <select
                className={`${styles.select} ${styles.selectTime}`}
                aria-labelledby="archive-filter-range"
                value={utcMonthFilter ? "all" : range}
                onChange={(e) => {
                  const next = e.target.value as DashboardAnalyticsRange;
                  setRange(next);
                  if (next !== "all") {
                    setUtcMonthFilter(null);
                  }
                }}
              >
                <option value="all">All time</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
              </select>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel} id="archive-filter-source">
                Source
              </span>
              <select
                className={`${styles.select} ${styles.selectSource}`}
                aria-labelledby="archive-filter-source"
                value={source}
                onChange={(e) => setSource(e.target.value as ArchiveListenSourceFilter)}
              >
                <option value="all">All sources</option>
                <option value="lastfm">Last.fm</option>
                <option value="import">Import</option>
                <option value="spotify">Spotify</option>
              </select>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel} id="archive-filter-type">
                Type
              </span>
              <select
                className={`${styles.select} ${styles.selectType}`}
                aria-labelledby="archive-filter-type"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as ArchiveListenTypeFilter)}
              >
                <option value="tracks">Tracks</option>
                <option value="artists">Artists</option>
                <option value="albums">Albums</option>
              </select>
            </div>
          </div>
        </div>
        </div>

        {!allowAiLayer1Reads ? (
          <section className={styles.archiveHighlightsGate} aria-label="Listening highlights">
            <DashboardListeningInsightsAdvancedGate variant="archive" />
          </section>
        ) : highlightAlbum != null || highlightArtist != null ? (
          <section
            className={styles.archiveHighlights}
            aria-label="All-time listening highlights"
          >
            <div className={styles.archiveHighlightsGrid}>
              <div
                className={
                  highlightAlbum
                    ? styles.archiveHighlightCard
                    : `${styles.archiveHighlightCard} ${styles.archiveHighlightCardMuted}`
                }
              >
                <DashboardCoverThumb
                  musicbrainzReleaseMbid={highlightAlbum?.musicbrainz_release_mbid ?? null}
                  lastfmCoverImageUrl={highlightAlbum?.lastfm_cover_image_url}
                  alt={
                    highlightAlbum
                      ? `${displayLabel(highlightAlbum.title, "Album")} · ${displayLabel(
                          highlightAlbum.artistName,
                          "Artist",
                        )}`
                      : "Top album"
                  }
                  rowSize="md"
                />
                <div className={styles.archiveHighlightBody}>
                  <p className={styles.archiveHighlightLabel}>Top album</p>
                  {highlightAlbum ? (
                    <>
                      <p className={styles.archiveHighlightTitle}>
                        {displayLabel(highlightAlbum.title, "[UNKNOWN ALBUM]")}
                      </p>
                      <p className={styles.archiveHighlightMeta}>
                        {displayLabel(highlightAlbum.artistName, "[UNKNOWN ARTIST]")}
                      </p>
                      <p className={styles.archiveHighlightPlays}>
                        {formatCount(highlightAlbum.plays)} plays
                      </p>
                    </>
                  ) : (
                    <p className={styles.archiveHighlightTitle}>No charted album yet</p>
                  )}
                </div>
              </div>
              <div
                className={
                  highlightArtist
                    ? styles.archiveHighlightCard
                    : `${styles.archiveHighlightCard} ${styles.archiveHighlightCardMuted}`
                }
              >
                <DashboardCoverThumb
                  musicbrainzReleaseMbid={highlightArtist?.musicbrainz_release_mbid ?? null}
                  lastfmCoverImageUrl={highlightArtist?.lastfm_cover_image_url}
                  alt={highlightArtist ? displayLabel(highlightArtist.name, "Artist") : "Top artist"}
                  rowSize="md"
                />
                <div className={styles.archiveHighlightBody}>
                  <p className={styles.archiveHighlightLabel}>Top artist</p>
                  {highlightArtist ? (
                    <>
                      <p className={styles.archiveHighlightTitle}>
                        {displayLabel(highlightArtist.name, "[UNKNOWN ARTIST]")}
                      </p>
                      <p className={styles.archiveHighlightPlays}>
                        {formatCount(highlightArtist.plays)} plays
                      </p>
                    </>
                  ) : (
                    <p className={styles.archiveHighlightTitle}>No charted artist yet</p>
                  )}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <div
          key={listSurfaceKey}
          className={styles.archiveListMount}
          aria-busy={loadingRefresh || loadingMore}
        >
        {loadError ? (
          <p className="mb-6 max-w-xl font-mono text-caption text-error" role="alert">
            {loadError}
          </p>
        ) : null}

        {loadError ? null : loadingRefresh ? (
          <div className={`${styles.listArea} ${styles.listAreaInitialLoading}`}>
            <p className={styles.loadingMore} aria-live="polite">
              {deferredInitialList && !refreshHadRows
                ? "Loading your first page of listens…"
                : refreshHadRows
                  ? "Updating plays for your filters…"
                  : "Gathering plays that match your filters…"}
            </p>
          </div>
        ) : listens.length === 0 ? (
          <div className={styles.emptyBlock}>
            <h2 className={styles.emptyTitle}>No listens matched</h2>
            <p className={styles.emptyBody}>
              Loosen a filter or try another search—your full history is still in the archive.
            </p>
          </div>
        ) : (
          <div className={styles.listArea}>
            {showActiveBar ? (
              <p className={styles.activeFilterBar}>FILTERED BY: {activeBarText}</p>
            ) : null}
            <div
              className={styles.tapeRail}
              role="group"
              aria-label="Archive scroll position within the play catalog and visible play range"
            >
              <div className={styles.tapeRailMeta}>
                <span className={styles.tapeRailLabel}>Tape head</span>
                <span>
                  <span ref={tapeSpanRef} className={styles.tapeRailSpan}>
                    —
                  </span>{" "}
                  <span ref={tapePctRef} className={styles.tapeRailPct} />
                </span>
              </div>
              <div className={styles.tapeRailTrack} aria-hidden>
                <div ref={tapeFillRef} className={styles.tapeRailFill} />
              </div>
            </div>
            <div
              ref={virtualScrollAnchorRef}
              className={styles.virtualListRegion}
              role="region"
              aria-label="Listen archive"
              aria-busy={loadingMore}
            >
              <div
                className={styles.virtualListHost}
                style={{
                  height: virtualizer.getTotalSize(),
                  width: "100%",
                  position: "relative",
                }}
              >
                {virtualizer.getVirtualItems().map((vi) => {
                  const row = flatRows[vi.index];
                  if (!row) return null;
                  const y = vi.start - scrollMargin;
                  return (
                    <div
                      key={vi.key}
                      data-index={vi.index}
                      ref={virtualizer.measureElement}
                      className={styles.virtualRow}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${y}px)`,
                      }}
                    >
                      <ArchiveVirtualRowView
                        row={row}
                        virtualIndex={vi.index}
                        displayTimeZone={displayTimeZone}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            {loadingMore ? (
              <p className={styles.loadingMore} aria-live="polite">
                Pulling the next page of plays…
              </p>
            ) : null}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
