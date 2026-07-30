import type { Pool } from "pg";
import { pgTimestamptzToIsoString } from "./pgTimestamptz.js";
import {
  LASTFM_COVER_IMAGE_URL_SQL,
  RECENT_LISTEN_ALBUM_TITLE_SQL,
  RECENT_LISTEN_ARTIST_DISPLAY_SQL,
  RECENT_LISTEN_RELEASE_MBID_SQL,
} from "./dashboardAnalyticsSqlFragments.js";
import {
  buildHeroTimelineMonthlyAllStatementSpec,
  buildHeroWeekdayPeakStatementSpec,
} from "./dashboardHeroStatements.js";
import { buildDashboardListenSummaryStatementSpecs } from "./dashboardListenSummaryStatements.js";

/** Window for dashboard aggregates; `all` uses no lower bound on `listens.played_at`. */
export type DashboardAnalyticsRange = "7d" | "30d" | "90d" | "all";

export type DashboardAnalyticsDbExecutor = Pick<Pool, "query">;

export type DashboardTopArtist = {
  /**
   * Opaque stable id for list keys (`md5` of the normalized display label). Not always equal to
   * `artists.id` — top artists follow Last.fm-style **scrobble artist strings**, not MusicBrainz
   * canonical rows (which split/merge differently than Last.fm’s charts).
   */
  artist_id: string;
  name: string;
  plays: number;
};

export type DashboardTopTrack = {
  track_id: string;
  title: string;
  artist_name: string;
  plays: number;
  /** Release MBID from the track's album when linked; used for Cover Art Archive. */
  musicbrainz_release_mbid: string | null;
  /** Last.fm CDN URL from `raw_scrobbles.raw_payload` when present (`extended=1` import). */
  lastfm_cover_image_url: string | null;
};

export type DashboardTopAlbum = {
  album_id: string;
  title: string;
  artist_name: string;
  plays: number;
  musicbrainz_release_mbid: string | null;
  lastfm_cover_image_url: string | null;
};

export type DashboardListenSummary = {
  range: DashboardAnalyticsRange;
  total_scrobbles: number;
  top_artists: DashboardTopArtist[];
  top_tracks: DashboardTopTrack[];
  top_albums: DashboardTopAlbum[];
};

/** Cover fields for archive highlight cards (release MBID + optional Last.fm CDN URL). */
export type ArchiveListenHighlightCover = {
  musicbrainz_release_mbid: string | null;
  lastfm_cover_image_url: string | null;
};

/**
 * All-time aggregates for `/dashboard/archive` SSR: totals plus top artist/album highlights.
 * Narrower than {@link DashboardListenSummary} (no full track chart).
 */
export type ArchiveListenPageSummary = {
  total_scrobbles: number;
  top_artist: DashboardTopArtist | null;
  top_album: DashboardTopAlbum | null;
  /**
   * Representative artwork for the top artist when it can be inferred from chart rows
   * (matching top track, else top album by the same credited artist).
   */
  top_artist_cover: ArchiveListenHighlightCover | null;
};

function normalizeArchiveArtistKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function inferArchiveArtistHighlightCover(
  topArtist: DashboardTopArtist | null,
  topAlbum: DashboardTopAlbum | null,
  topTracks: readonly DashboardTopTrack[],
): ArchiveListenHighlightCover | null {
  if (!topArtist) {
    return null;
  }
  const key = normalizeArchiveArtistKey(topArtist.name);
  for (const t of topTracks) {
    if (normalizeArchiveArtistKey(t.artist_name) !== key) {
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
    normalizeArchiveArtistKey(topAlbum.artist_name) === key &&
    (topAlbum.musicbrainz_release_mbid || topAlbum.lastfm_cover_image_url)
  ) {
    return {
      musicbrainz_release_mbid: topAlbum.musicbrainz_release_mbid,
      lastfm_cover_image_url: topAlbum.lastfm_cover_image_url,
    };
  }
  return null;
}

/** Maps a full `ranges.all.summary` bundle slot into the archive strip contract. */
export function archiveListenPageSummaryFromDashboardAllSummary(
  summary: DashboardListenSummary,
): ArchiveListenPageSummary {
  const topArtist = summary.top_artists[0] ?? null;
  const topAlbum = summary.top_albums[0] ?? null;
  return {
    total_scrobbles: summary.total_scrobbles,
    top_artist: topArtist,
    top_album: topAlbum,
    top_artist_cover: inferArchiveArtistHighlightCover(topArtist, topAlbum, summary.top_tracks),
  };
}

export type DashboardRecentListen = {
  listen_id: string;
  played_at: string;
  track_id: string;
  track_title: string;
  artist_name: string;
  album_id: string | null;
  album_title: string | null;
  musicbrainz_release_mbid: string | null;
  lastfm_cover_image_url: string | null;
};

/** `/dashboard/archive` filters — canonical listens only (Spotify reserved for future sources). */
export type ArchiveListenSourceFilter = "all" | "lastfm" | "import" | "spotify";

/** Which fields {@link getArchiveListensPage} matches the optional `q` needle against. */
export type ArchiveListenTypeFilter = "tracks" | "artists" | "albums";

export type DashboardArchiveListen = DashboardRecentListen & {
  /** Row provenance for the archive list (UI maps to LAST.FM / IMPORT). */
  listen_source: "lastfm" | "import";
};

/** Peak UTC weekday in a window (`utc_weekday` matches `Date#getUTCDay()`, 0 = Sunday). */
export type DashboardHeroWeekdayPeak = {
  utc_weekday: number;
  plays: number;
};

export type DashboardHeroTimelinePoint = {
  /** UTC calendar day `YYYY-MM-DD`, or month start `YYYY-MM-01` when {@link DashboardHeroWindowMetrics.timeline_grain} is `utc_month`. */
  period_start: string;
  count: number;
};

export type DashboardHeroWindowMetrics = {
  weekday_peak: DashboardHeroWeekdayPeak | null;
  timeline_grain: "utc_day" | "utc_month";
  timeline: DashboardHeroTimelinePoint[];
};

/**
 * Calendar-day bucketing for {@link getDashboardHeroWindowMetrics} daily timelines and weekday
 * peaks. Use UTC (`YYYY-MM-DD` from UTC instants, zone `UTC`) to match historical dashboard stats.
 */
export type DashboardHeroWindowCalendarInput = Readonly<{
  timelineDayStartYmd: string;
  timelineDayEndYmd: string;
  ianaTimeZone: string;
}>;

const DEFAULT_TOP_LIMIT = 10;
const DEFAULT_RECENT_LIMIT = 50;
const MAX_RECENT_LIMIT = 100;

const DEFAULT_ARCHIVE_PAGE_LIMIT = 40;
const MAX_ARCHIVE_PAGE_LIMIT = 100;
/** Larger batches for authenticated full exports (not exposed to public query-param APIs). */
const MAX_EXPORT_ARCHIVE_PAGE_LIMIT = 2000;

export function parseDashboardAnalyticsRange(
  raw: string | null | undefined,
): DashboardAnalyticsRange | null {
  if (raw === undefined || raw === null || raw === "") {
    return "30d";
  }
  if (raw === "7d" || raw === "30d" || raw === "90d" || raw === "all") {
    return raw;
  }
  return null;
}

export function playedAtLowerBoundUtc(
  range: DashboardAnalyticsRange,
  nowMs: number,
): Date | null {
  if (range === "all") {
    return null;
  }
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return new Date(nowMs - days * 86_400_000);
}

export function recentListensLimitFromQueryParam(
  raw: string | null | undefined,
): number {
  const n =
    raw === undefined || raw === null || raw === ""
      ? DEFAULT_RECENT_LIMIT
      : Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_RECENT_LIMIT;
  }
  return Math.min(Math.floor(n), MAX_RECENT_LIMIT);
}

export function parseArchiveListenSourceFilter(
  raw: string | null | undefined,
): ArchiveListenSourceFilter | null {
  if (raw === undefined || raw === null || raw === "" || raw === "all") {
    return "all";
  }
  if (raw === "lastfm" || raw === "import" || raw === "spotify") {
    return raw;
  }
  return null;
}

export function parseArchiveListenTypeFilter(
  raw: string | null | undefined,
): ArchiveListenTypeFilter | null {
  if (raw === undefined || raw === null || raw === "" || raw === "tracks") {
    return "tracks";
  }
  if (raw === "artists" || raw === "albums") {
    return raw;
  }
  return null;
}

export function archiveListensLimitFromQueryParam(
  raw: string | null | undefined,
): number {
  const n =
    raw === undefined || raw === null || raw === ""
      ? DEFAULT_ARCHIVE_PAGE_LIMIT
      : Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_ARCHIVE_PAGE_LIMIT;
  }
  return Math.min(Math.floor(n), MAX_ARCHIVE_PAGE_LIMIT);
}

function topLimitOrDefault(topLimit?: number): number {
  if (topLimit === undefined || !Number.isFinite(topLimit) || topLimit < 1) {
    return DEFAULT_TOP_LIMIT;
  }
  return Math.min(Math.floor(topLimit), 50);
}

function clampListenLimit(n: number): number {
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_RECENT_LIMIT;
  }
  return Math.min(Math.floor(n), MAX_RECENT_LIMIT);
}

function clampArchiveListenLimit(n: number): number {
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_ARCHIVE_PAGE_LIMIT;
  }
  return Math.min(Math.floor(n), MAX_ARCHIVE_PAGE_LIMIT);
}

function clampExportArchiveListenLimit(n: number): number {
  if (!Number.isFinite(n) || n < 1) {
    return MAX_EXPORT_ARCHIVE_PAGE_LIMIT;
  }
  return Math.min(Math.floor(n), MAX_EXPORT_ARCHIVE_PAGE_LIMIT);
}

/**
 * Aggregates over canonical `listens` rows (joined to `tracks` / `artists` / `albums`),
 * never raw import rows.
 */
export async function getDashboardListenSummary(
  db: DashboardAnalyticsDbExecutor,
  input: {
    userId: string;
    range: DashboardAnalyticsRange;
    topLimit?: number;
    nowMs?: number;
    /** Half-open UTC window on `listens.played_at`; when set, overrides rolling {@link input.range} bounds. */
    playedAtUtcWindow?: { gteIso: string; ltExclusiveIso: string } | null;
  },
): Promise<DashboardListenSummary> {
  const nowMs = input.nowMs ?? Date.now();
  let since: Date | null;
  let untilExclusive: Date | null;
  if (input.playedAtUtcWindow) {
    since = new Date(input.playedAtUtcWindow.gteIso);
    untilExclusive = new Date(input.playedAtUtcWindow.ltExclusiveIso);
  } else {
    since = playedAtLowerBoundUtc(input.range, nowMs);
    untilExclusive = null;
  }
  const topLimit = topLimitOrDefault(input.topLimit);
  const specs = buildDashboardListenSummaryStatementSpecs({
    userId: input.userId,
    since,
    untilExclusive,
    topLimit,
  });

  const [totalRow, artists, tracks, albums] = await Promise.all([
    db.query<{ c: string }>(specs[0].text, specs[0].values),
    db.query<{
      artist_id: string;
      name: string;
      plays: number;
    }>(specs[1].text, specs[1].values),
    db.query<{
      track_id: string;
      title: string;
      artist_name: string;
      plays: number;
      musicbrainz_release_mbid: string | null;
      lastfm_cover_image_url: string | null;
    }>(specs[2].text, specs[2].values),
    db.query<{
      album_id: string;
      title: string;
      artist_name: string;
      plays: number;
      musicbrainz_release_mbid: string | null;
      lastfm_cover_image_url: string | null;
    }>(specs[3].text, specs[3].values),
  ]);

  const total = totalRow.rows[0]?.c ?? 0;

  return {
    range: input.range,
    total_scrobbles: typeof total === "number" ? total : Number(total),
    top_artists: artists.rows.map((r) => ({
      artist_id: r.artist_id,
      name: r.name,
      plays: r.plays,
    })),
    top_tracks: tracks.rows.map((r) => ({
      track_id: r.track_id,
      title: r.title,
      artist_name: r.artist_name,
      plays: r.plays,
      musicbrainz_release_mbid: r.musicbrainz_release_mbid,
      lastfm_cover_image_url: r.lastfm_cover_image_url,
    })),
    top_albums: albums.rows.map((r) => ({
      album_id: r.album_id,
      title: r.title,
      artist_name: r.artist_name,
      plays: r.plays,
      musicbrainz_release_mbid: r.musicbrainz_release_mbid,
      lastfm_cover_image_url: r.lastfm_cover_image_url,
    })),
  };
}

/**
 * All-time totals for `/dashboard/archive` when no fresh `dashboard_bundle_v1` snapshot exists.
 * Runs total + top artist + top album (limit 1 each) without full track chart rollups.
 */
export async function getDashboardListenSummaryArchivePageHeader(
  db: DashboardAnalyticsDbExecutor,
  input: { userId: string; nowMs?: number },
): Promise<ArchiveListenPageSummary> {
  const nowMs = input.nowMs ?? Date.now();
  const since = playedAtLowerBoundUtc("all", nowMs);
  const specs = buildDashboardListenSummaryStatementSpecs({
    userId: input.userId,
    since,
    untilExclusive: null,
    topLimit: 1,
  });
  const [totalRow, artists, albums] = await Promise.all([
    db.query<{ c: string }>(specs[0].text, specs[0].values),
    db.query<{
      artist_id: string;
      name: string;
      plays: number;
    }>(specs[1].text, specs[1].values),
    db.query<{
      album_id: string;
      title: string;
      artist_name: string;
      plays: number;
      musicbrainz_release_mbid: string | null;
      lastfm_cover_image_url: string | null;
    }>(specs[3].text, specs[3].values),
  ]);
  const total = totalRow.rows[0]?.c ?? 0;
  const top = artists.rows[0];
  const topArtist: DashboardTopArtist | null = top
    ? {
        artist_id: top.artist_id,
        name: top.name,
        plays: top.plays,
      }
    : null;
  const al = albums.rows[0];
  const topAlbum: DashboardTopAlbum | null = al
    ? {
        album_id: al.album_id,
        title: al.title,
        artist_name: al.artist_name,
        plays: al.plays,
        musicbrainz_release_mbid: al.musicbrainz_release_mbid,
        lastfm_cover_image_url: al.lastfm_cover_image_url,
      }
    : null;
  return {
    total_scrobbles: typeof total === "number" ? total : Number(total),
    top_artist: topArtist,
    top_album: topAlbum,
    top_artist_cover: inferArchiveArtistHighlightCover(topArtist, topAlbum, []),
  };
}

/** Newest canonical listens first for the authenticated user and range. */
export async function getDashboardRecentListens(
  db: DashboardAnalyticsDbExecutor,
  input: {
    userId: string;
    range: DashboardAnalyticsRange;
    limit: number;
    nowMs?: number;
  },
): Promise<DashboardRecentListen[]> {
  const nowMs = input.nowMs ?? Date.now();
  const since = playedAtLowerBoundUtc(input.range, nowMs);
  const limit = clampListenLimit(input.limit);
  const { rows } = await db.query<{
    listen_id: string;
    played_at: string;
    track_id: string;
    track_title: string;
    artist_name: string;
    album_id: string | null;
    album_title: string | null;
    musicbrainz_release_mbid: string | null;
    lastfm_cover_image_url: string | null;
  }>(
    `select l.id as listen_id,
            l.played_at,
            t.id as track_id,
            t.title as track_title,
            ${RECENT_LISTEN_ARTIST_DISPLAY_SQL} as artist_name,
            al.id as album_id,
            ${RECENT_LISTEN_ALBUM_TITLE_SQL} as album_title,
            ${RECENT_LISTEN_RELEASE_MBID_SQL} as musicbrainz_release_mbid,
            ${LASTFM_COVER_IMAGE_URL_SQL} as lastfm_cover_image_url
     from listens l
     join tracks t on t.id = l.track_id
     join artists ar_track on ar_track.id = t.artist_id
     left join albums al on al.id = t.album_id
     left join artists ar_album on ar_album.id = al.artist_id
     left join raw_scrobbles rs on rs.id = l.raw_scrobble_id
     where l.user_id = $1::uuid
       and ($2::timestamptz is null or l.played_at >= $2::timestamptz)
     order by l.played_at desc, l.id desc
     limit $3::int`,
    [input.userId, since, limit],
  );
  return rows.map((r) => ({
    listen_id: r.listen_id,
    played_at: pgTimestamptzToIsoString(r.played_at),
    track_id: r.track_id,
    track_title: r.track_title,
    artist_name: r.artist_name,
    album_id: r.album_id,
    album_title: r.album_title,
    musicbrainz_release_mbid: r.musicbrainz_release_mbid,
    lastfm_cover_image_url: r.lastfm_cover_image_url,
  }));
}

/**
 * Keyset-paginated archive listens (newest first). Optional substring match on track / artist /
 * album fields depending on {@link ArchiveListenTypeFilter}.
 *
 * **VS-69 viewport note:** Row projections match {@link DashboardArchiveListen} (UI + export
 * worker). Bounded pagination satisfies the ticket’s viewport constraint for list rows; we do
 * not omit columns here because the archive surface requires them.
 */
export async function getArchiveListensPage(
  db: DashboardAnalyticsDbExecutor,
  input: {
    userId: string;
    range: DashboardAnalyticsRange;
    limit: number;
    nowMs?: number;
    cursor: { played_at: string; listen_id: string } | null;
    q: string | null | undefined;
    source: ArchiveListenSourceFilter;
    type: ArchiveListenTypeFilter;
    /** When `"export"`, allows larger page sizes (up to 2000 rows) for trusted server-side exports. */
    limitMode?: "export";
    /**
     * Optional UTC half-open window `[gteIso, ltExclusiveIso)` on `listens.played_at`.
     * When set, rolling `range` lower bound is ignored (callers should pass `range: "all"`).
     */
    playedAtUtcWindow?: { gteIso: string; ltExclusiveIso: string } | null;
  },
): Promise<DashboardArchiveListen[]> {
  const nowMs = input.nowMs ?? Date.now();
  const w = input.playedAtUtcWindow;
  const useUtcWindow =
    w !== null &&
    w !== undefined &&
    w.gteIso.trim() !== "" &&
    w.ltExclusiveIso.trim() !== "";
  const since = useUtcWindow ? null : playedAtLowerBoundUtc(input.range, nowMs);
  const limit =
    input.limitMode === "export"
      ? clampExportArchiveListenLimit(input.limit)
      : clampArchiveListenLimit(input.limit);
  const needleParam = (input.q ?? "").trim();
  const cursor = input.cursor;
  const hasCursor =
    cursor !== null &&
    cursor.played_at.trim() !== "" &&
    cursor.listen_id.trim() !== "";

  const source = input.source;
  const type = input.type;

  const { rows } = await db.query<{
    listen_id: string;
    played_at: string;
    track_id: string;
    track_title: string;
    artist_name: string;
    album_id: string | null;
    album_title: string | null;
    musicbrainz_release_mbid: string | null;
    lastfm_cover_image_url: string | null;
    listen_source: string;
  }>(
    `select l.id as listen_id,
            l.played_at,
            t.id as track_id,
            t.title as track_title,
            ${RECENT_LISTEN_ARTIST_DISPLAY_SQL} as artist_name,
            al.id as album_id,
            ${RECENT_LISTEN_ALBUM_TITLE_SQL} as album_title,
            ${RECENT_LISTEN_RELEASE_MBID_SQL} as musicbrainz_release_mbid,
            ${LASTFM_COVER_IMAGE_URL_SQL} as lastfm_cover_image_url,
            case
              when ij.id is not null and ij.source = 'user' then 'import'
              else 'lastfm'
            end as listen_source
       from listens l
       join tracks t on t.id = l.track_id
       join artists ar_track on ar_track.id = t.artist_id
       left join albums al on al.id = t.album_id
       left join artists ar_album on ar_album.id = al.artist_id
       left join raw_scrobbles rs on rs.id = l.raw_scrobble_id
       left join import_jobs ij on ij.id = l.import_job_id and ij.user_id = l.user_id
      where l.user_id = $1::uuid
        and (
          case
            when $12::boolean
            then l.played_at >= $10::timestamptz and l.played_at < $11::timestamptz
            else ($2::timestamptz is null or l.played_at >= $2::timestamptz)
          end
        )
        and (
          not $3::boolean
          or (l.played_at, l.id) < ($4::timestamptz, $5::uuid)
        )
        and (
          $6::text = 'all'
          or ($6::text = 'import' and ij.source = 'user')
          or (
            $6::text = 'lastfm'
            and (
              l.import_job_id is null
              or ij.source is null
              or ij.source = 'system_sync'
            )
          )
          or ($6::text = 'spotify' and false)
        )
        and (
          length(trim(coalesce($7::text, ''))) = 0
          or (
            $8::text = 'tracks'
            and (
              position(lower(trim($7::text)) in lower(t.title)) > 0
              or position(lower(trim($7::text)) in lower(${RECENT_LISTEN_ARTIST_DISPLAY_SQL})) > 0
              or position(lower(trim($7::text)) in lower(coalesce(${RECENT_LISTEN_ALBUM_TITLE_SQL}, ''))) > 0
            )
          )
          or (
            $8::text = 'artists'
            and position(lower(trim($7::text)) in lower(${RECENT_LISTEN_ARTIST_DISPLAY_SQL})) > 0
          )
          or (
            $8::text = 'albums'
            and position(lower(trim($7::text)) in lower(coalesce(${RECENT_LISTEN_ALBUM_TITLE_SQL}, ''))) > 0
          )
        )
      order by l.played_at desc, l.id desc
      limit $9::int`,
    [
      input.userId,
      since,
      hasCursor,
      hasCursor && cursor !== null ? cursor.played_at : null,
      hasCursor && cursor !== null ? cursor.listen_id : null,
      source,
      needleParam,
      type,
      limit,
      useUtcWindow && w !== undefined ? w.gteIso : null,
      useUtcWindow && w !== undefined ? w.ltExclusiveIso : null,
      useUtcWindow,
    ],
  );

  return rows.map((r) => ({
    listen_id: r.listen_id,
    played_at: pgTimestamptzToIsoString(r.played_at),
    track_id: r.track_id,
    track_title: r.track_title,
    artist_name: r.artist_name,
    album_id: r.album_id,
    album_title: r.album_title,
    musicbrainz_release_mbid: r.musicbrainz_release_mbid,
    lastfm_cover_image_url: r.lastfm_cover_image_url,
    listen_source: r.listen_source === "import" ? "import" : "lastfm",
  }));
}

function utcYmdFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function queryDashboardWeekdayPeak(
  db: DashboardAnalyticsDbExecutor,
  userId: string,
  since: Date | null,
  calendarTimeZone: string,
): Promise<DashboardHeroWeekdayPeak | null> {
  const spec = buildHeroWeekdayPeakStatementSpec(userId, since, calendarTimeZone);
  const { rows } = await db.query<{ utc_weekday: unknown; plays: unknown }>(
    spec.text,
    spec.values,
  );
  const r = rows[0];
  if (!r) {
    return null;
  }
  const plays = typeof r.plays === "number" ? r.plays : Number(r.plays);
  if (!Number.isFinite(plays) || plays < 1) {
    return null;
  }
  const utc_weekday = Number(r.utc_weekday);
  if (!Number.isFinite(utc_weekday) || utc_weekday < 0 || utc_weekday > 6) {
    return null;
  }
  return { utc_weekday, plays };
}

async function queryDashboardTimelineDailyDense(
  db: DashboardAnalyticsDbExecutor,
  userId: string,
  since: Date,
  nowMs: number,
  input: Readonly<{ d0: string; d1: string; calendarTimeZone: string }>,
): Promise<DashboardHeroTimelinePoint[]> {
  let { d0, d1 } = input;
  if (d0 > d1) {
    d0 = d1;
  }
  const now = new Date(nowMs);
  const { rows } = await db.query<{ period_start: string; count: unknown }>(
    `with bounds as (
        select $2::date as d0, $3::date as d1
     ),
     days as (
        select gs::date as day
        from bounds,
        lateral generate_series(bounds.d0, bounds.d1, interval '1 day') as gs
     ),
     agg as (
        select (l.played_at at time zone $6::text)::date as day,
               count(*)::int as c
          from listens l
         where l.user_id = $1::uuid
           and l.played_at >= $4::timestamptz
           and l.played_at <= $5::timestamptz
         group by 1
     )
     select to_char(days.day, 'YYYY-MM-DD') as period_start,
            coalesce(agg.c, 0)::int as count
       from days
       left join agg on agg.day = days.day
      order by days.day asc`,
    [userId, d0, d1, since, now, input.calendarTimeZone],
  );
  return rows.map((row) => ({
    period_start: row.period_start,
    count: typeof row.count === "number" ? row.count : Number(row.count),
  }));
}

async function queryDashboardTimelineMonthlyRecent(
  db: DashboardAnalyticsDbExecutor,
  userId: string,
): Promise<DashboardHeroTimelinePoint[]> {
  const spec = buildHeroTimelineMonthlyAllStatementSpec(userId);
  const { rows } = await db.query<{ period_start: string; count: unknown }>(
    spec.text,
    spec.values,
  );
  return rows.map((row) => ({
    period_start: row.period_start,
    count: typeof row.count === "number" ? row.count : Number(row.count),
  }));
}

/**
 * Full-window aggregates for the listening hero: peak weekday and timeline shape use **all**
 * plays in the range (not the capped “recent listens” list).
 */
export async function getDashboardHeroWindowMetrics(
  db: DashboardAnalyticsDbExecutor,
  input: {
    userId: string;
    range: DashboardAnalyticsRange;
    nowMs?: number;
    /** When set for bounded ranges, buckets timeline + weekday peak using this local calendar. */
    heroCalendar?: DashboardHeroWindowCalendarInput | null;
  },
): Promise<DashboardHeroWindowMetrics> {
  const nowMs = input.nowMs ?? Date.now();
  const since = playedAtLowerBoundUtc(input.range, nowMs);

  if (input.range === "all") {
    const [weekday_peak, timeline] = await Promise.all([
      queryDashboardWeekdayPeak(db, input.userId, null, "UTC"),
      queryDashboardTimelineMonthlyRecent(db, input.userId),
    ]);
    return {
      weekday_peak,
      timeline_grain: "utc_month",
      timeline,
    };
  }

  if (!since) {
    throw new Error("getDashboardHeroWindowMetrics: bounded range missing since cutoff");
  }

  const cal =
    input.heroCalendar ??
    ({
      timelineDayStartYmd: utcYmdFromMs(since.getTime()),
      timelineDayEndYmd: utcYmdFromMs(nowMs),
      ianaTimeZone: "UTC",
    } satisfies DashboardHeroWindowCalendarInput);

  const [weekday_peak, timeline] = await Promise.all([
    queryDashboardWeekdayPeak(db, input.userId, since, cal.ianaTimeZone),
    queryDashboardTimelineDailyDense(db, input.userId, since, nowMs, {
      d0: cal.timelineDayStartYmd,
      d1: cal.timelineDayEndYmd,
      calendarTimeZone: cal.ianaTimeZone,
    }),
  ]);

  return {
    weekday_peak,
    timeline_grain: "utc_day",
    timeline,
  };
}

/** Earliest canonical listen timestamp for the user, if any. */
export async function getEarliestListenPlayedAtForUser(
  db: DashboardAnalyticsDbExecutor,
  userId: string,
): Promise<string | null> {
  const { rows } = await db.query<{ played_at: unknown }>(
    `select l.played_at
     from listens l
     where l.user_id = $1::uuid
     order by l.played_at asc, l.id asc
     limit 1`,
    [userId],
  );
  const r = rows[0];
  return r ? pgTimestamptzToIsoString(r.played_at) : null;
}
