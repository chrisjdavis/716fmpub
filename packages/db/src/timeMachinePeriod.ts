/**
 * Musical Time Machine — calendar period reads.
 *
 * Buckets follow {@link recomputeUserListenPeriodMetrics}: UTC `date_trunc` months stored in
 * `user_listen_period_metrics.period_start` (first day of month, UTC calendar).
 * This matches {@link users.stats_timezone} only when that zone is UTC; callers label months in UTC
 * for consistency with stored rollups.
 */
import type { DashboardAnalyticsDbExecutor } from "./dashboardAnalytics.js";
import {
  ARTIST_DISPLAY_TOP_ALBUM_SQL,
  ARTIST_DISPLAY_TOP_TRACK_SQL,
  LASTFM_COVER_IMAGE_URL_SQL,
  RECENT_LISTEN_ALBUM_TITLE_SQL,
} from "./dashboardAnalyticsSqlFragments.js";

/** Explore scrubber: full timeline vs months with at least one “new to you” artist. */
export type TimeMachineTimelineView = "full" | "new-music";

export type TimeMachineMonthDensityRow = Readonly<{
  period_start: string;
  play_count: number;
  /** Artists whose first canonical listen falls in this UTC calendar month (`user_artist_listen_stats`). */
  new_artist_count: number;
}>;

export type TimeMachineMonthMetricsRow = Readonly<{
  period_start: string;
  play_count: number;
  unique_track_count: number;
  unique_artist_count: number;
  unique_album_count: number;
  top_artist_name: string | null;
  top_artist_plays: number | null;
  top_track_title: string | null;
  top_track_plays: number | null;
}>;

const MONTH_YYYY_MM = /^(\d{4})-(\d{2})$/;

/**
 * Validates `YYYY-MM` and returns the canonical key or null.
 */
export function parseTimeMachineMonthYyyMm(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const t = String(raw).trim();
  const m = MONTH_YYYY_MM.exec(t);
  if (!m) {
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isFinite(y) || y < 1970 || y > 2100 || mo < 1 || mo > 12) {
    return null;
  }
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}`;
}

/** Inclusive UTC start and exclusive UTC end as ISO strings for `listens.played_at`. */
export function utcCalendarMonthBoundsIso(yyyymm: string): { gteIso: string; ltExclusiveIso: string } | null {
  const key = parseTimeMachineMonthYyyMm(yyyymm);
  if (!key) {
    return null;
  }
  const [ys, ms] = key.split("-");
  const y = Number(ys);
  const mo = Number(ms);
  const startMs = Date.UTC(y, mo - 1, 1, 0, 0, 0, 0);
  const endExclusiveMs = Date.UTC(y, mo, 1, 0, 0, 0, 0);
  return {
    gteIso: new Date(startMs).toISOString(),
    ltExclusiveIso: new Date(endExclusiveMs).toISOString(),
  };
}

/** Next calendar month key, or null if invalid / past supported range. */
export function nextUtcCalendarMonthYyyMm(yyyymm: string): string | null {
  const key = parseTimeMachineMonthYyyMm(yyyymm);
  if (!key) {
    return null;
  }
  const [ys, ms] = key.split("-").map(Number);
  if (!Number.isFinite(ys) || !Number.isFinite(ms)) {
    return null;
  }
  const d = new Date(Date.UTC(ys, ms, 1));
  if (d.getUTCFullYear() > 2100) {
    return null;
  }
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Previous calendar month key, or null if `yyyymm` is January 1970 or invalid. */
export function previousUtcCalendarMonthYyyMm(yyyymm: string): string | null {
  const key = parseTimeMachineMonthYyyMm(yyyymm);
  if (!key) {
    return null;
  }
  const [ys, ms] = key.split("-");
  const y = Number(ys);
  const mo = Number(ms);
  const d = new Date(Date.UTC(y, mo - 2, 1));
  if (d.getUTCFullYear() < 1970) {
    return null;
  }
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Same calendar month one UTC year earlier (`2018-04` → `2017-04`), or null when out of range / invalid.
 */
export function sameUtcCalendarMonthOneYearPriorYyyMm(yyyymm: string): string | null {
  const key = parseTimeMachineMonthYyyMm(yyyymm);
  if (!key) {
    return null;
  }
  const [ys, ms] = key.split("-");
  const y = Number(ys);
  const mo = Number(ms);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || y - 1 < 1970) {
    return null;
  }
  return `${String(y - 1).padStart(4, "0")}-${String(mo).padStart(2, "0")}`;
}

/** UTC Jan 1 for the year of `YYYY-MM` (e.g. `2017-04` → `2017-01-01`). */
export function utcCalendarYearStartYmdFromMonthYyyMm(yyyymm: string): string | null {
  const key = parseTimeMachineMonthYyyMm(yyyymm);
  if (!key) {
    return null;
  }
  return `${key.slice(0, 4)}-01-01`;
}

export type TimeMachineWeekOverlapRow = Readonly<{
  period_start: string;
  play_count: number;
}>;

export async function listUserTimeMachineMonthDensity(
  db: DashboardAnalyticsDbExecutor,
  userId: string,
): Promise<TimeMachineMonthDensityRow[]> {
  const { rows } = await db.query<{
    period_start: string;
    play_count: number;
    new_artist_count: number;
  }>(
    `select m.period_start::text as period_start,
            m.play_count,
            coalesce((
              select count(*)::int
                from user_artist_listen_stats s
               where s.user_id = m.user_id
                 and s.first_played_at >= (m.period_start::timestamp AT TIME ZONE 'UTC')
                 and s.first_played_at < ((m.period_start + interval '1 month')::date::timestamp AT TIME ZONE 'UTC')
            ), 0) as new_artist_count
       from user_listen_period_metrics m
      where m.user_id = $1::uuid
        and m.period_kind = 'calendar_month'
        and m.play_count > 0
      order by m.period_start asc`,
    [userId],
  );
  return rows.map((r) => ({
    period_start: r.period_start,
    play_count: r.play_count,
    new_artist_count:
      typeof r.new_artist_count === "number" && Number.isFinite(r.new_artist_count)
        ? r.new_artist_count
        : Number(r.new_artist_count) || 0,
  }));
}

export async function getUserTimeMachineMonthMetrics(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{ userId: string; periodStartYmd: string }>,
): Promise<TimeMachineMonthMetricsRow | null> {
  const { rows } = await db.query<{
    period_start: string;
    play_count: number;
    unique_track_count: number;
    unique_artist_count: number;
    unique_album_count: number;
    top_artist_name: string | null;
    top_artist_plays: number | null;
    top_track_title: string | null;
    top_track_plays: number | null;
  }>(
    `select m.period_start::text as period_start,
            m.play_count,
            m.unique_track_count,
            m.unique_artist_count,
            m.unique_album_count,
            m.top_artist_name,
            m.top_artist_plays,
            m.top_track_title,
            m.top_track_plays
       from user_listen_period_metrics m
      where m.user_id = $1::uuid
        and m.period_kind = 'calendar_month'
        and m.period_start = $2::date
      limit 1`,
    [input.userId, input.periodStartYmd],
  );
  const r = rows[0];
  if (!r) {
    return null;
  }
  return {
    period_start: r.period_start,
    play_count: r.play_count,
    unique_track_count: r.unique_track_count,
    unique_artist_count: r.unique_artist_count,
    unique_album_count: r.unique_album_count,
    top_artist_name: r.top_artist_name,
    top_artist_plays: r.top_artist_plays,
    top_track_title: r.top_track_title,
    top_track_plays: r.top_track_plays,
  };
}

export async function getUserTimeMachineYearMetrics(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{ userId: string; periodStartYmd: string }>,
): Promise<TimeMachineMonthMetricsRow | null> {
  const { rows } = await db.query<{
    period_start: string;
    play_count: number;
    unique_track_count: number;
    unique_artist_count: number;
    unique_album_count: number;
    top_artist_name: string | null;
    top_artist_plays: number | null;
    top_track_title: string | null;
    top_track_plays: number | null;
  }>(
    `select m.period_start::text as period_start,
            m.play_count,
            m.unique_track_count,
            m.unique_artist_count,
            m.unique_album_count,
            m.top_artist_name,
            m.top_artist_plays,
            m.top_track_title,
            m.top_track_plays
       from user_listen_period_metrics m
      where m.user_id = $1::uuid
        and m.period_kind = 'calendar_year'
        and m.period_start = $2::date
      limit 1`,
    [input.userId, input.periodStartYmd],
  );
  const r = rows[0];
  if (!r) {
    return null;
  }
  return {
    period_start: r.period_start,
    play_count: r.play_count,
    unique_track_count: r.unique_track_count,
    unique_artist_count: r.unique_artist_count,
    unique_album_count: r.unique_album_count,
    top_artist_name: r.top_artist_name,
    top_artist_plays: r.top_artist_plays,
    top_track_title: r.top_track_title,
    top_track_plays: r.top_track_plays,
  };
}

/**
 * Calendar weeks whose UTC bucket overlaps `[monthStart, monthEndExclusive)` (half-open month).
 */
export async function listUserTimeMachineWeeksOverlappingUtcMonth(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{ userId: string; monthYyyMm: string }>,
): Promise<TimeMachineWeekOverlapRow[]> {
  const bounds = utcCalendarMonthBoundsIso(input.monthYyyMm);
  if (!bounds) {
    return [];
  }
  const monthStartYmd = bounds.gteIso.slice(0, 10);
  const monthEndExclusiveYmd = bounds.ltExclusiveIso.slice(0, 10);
  const { rows } = await db.query<{ period_start: string; play_count: number }>(
    `select m.period_start::text as period_start,
            m.play_count
       from user_listen_period_metrics m
      where m.user_id = $1::uuid
        and m.period_kind = 'calendar_week'
        and m.period_start::date < $3::date
        and m.period_start::date + interval '7 days' > $2::date
      order by m.period_start asc`,
    [input.userId, monthStartYmd, monthEndExclusiveYmd],
  );
  return rows.map((r) => ({
    period_start: r.period_start,
    play_count: r.play_count,
  }));
}

/**
 * Artists whose first canonical listen falls in `[gteIso, ltExclusiveIso)`.
 */
export async function countUserArtistsFirstPlayInUtcWindow(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{ userId: string; gteIso: string; ltExclusiveIso: string }>,
): Promise<number> {
  const { rows } = await db.query<{ c: string }>(
    `select count(*)::text as c
       from user_artist_listen_stats s
      where s.user_id = $1::uuid
        and s.first_played_at >= $2::timestamptz
        and s.first_played_at < $3::timestamptz`,
    [input.userId, input.gteIso, input.ltExclusiveIso],
  );
  const c = rows[0]?.c ?? "0";
  const n = Number(c);
  return Number.isFinite(n) ? n : 0;
}

export type UserNewArtistInUtcWindowRow = Readonly<{
  artistName: string;
  playsInWindow: number;
}>;

/**
 * Artists whose first canonical listen falls in `[gteIso, ltExclusiveIso)`, ranked by how
 * often they were played in that same window (ties broken by name).
 */
export async function listUserNewArtistsFirstPlayInUtcWindowRanked(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{ userId: string; gteIso: string; ltExclusiveIso: string; limit?: number }>,
): Promise<Readonly<{ artists: readonly UserNewArtistInUtcWindowRow[]; totalCount: number }>> {
  const limit = input.limit ?? 24;
  const { rows } = await db.query<{ artist_name: string; plays_in_window: string; total_count: string }>(
    `with new_artists as (
        select s.artist_id
          from user_artist_listen_stats s
         where s.user_id = $1::uuid
           and s.first_played_at >= $2::timestamptz
           and s.first_played_at < $3::timestamptz
      ),
      plays as (
        select t.artist_id, count(*)::bigint as c
          from listens l
          join tracks t on t.id = l.track_id
          join new_artists na on na.artist_id = t.artist_id
         where l.user_id = $1::uuid
           and l.played_at >= $2::timestamptz
           and l.played_at < $3::timestamptz
         group by t.artist_id
      ),
      joined as (
        select a.name as artist_name, coalesce(p.c, 0::bigint) as plays_in_window
          from new_artists na
          join artists a on a.id = na.artist_id
          left join plays p on p.artist_id = na.artist_id
      ),
      counted as (
        select j.*, count(*) over ()::text as total_count
          from joined j
      )
     select c.artist_name,
            c.plays_in_window::text as plays_in_window,
            c.total_count
       from counted c
      order by c.plays_in_window desc, c.artist_name asc
      limit $4::int`,
    [input.userId, input.gteIso, input.ltExclusiveIso, limit],
  );
  const totalRaw = rows[0]?.total_count ?? "0";
  const totalN = Number(totalRaw);
  const totalCount = Number.isFinite(totalN) ? totalN : 0;
  const artists = rows.map((r) => {
    const plays = Number(r.plays_in_window);
    return {
      artistName: r.artist_name,
      playsInWindow: Number.isFinite(plays) ? plays : 0,
    };
  });
  return { artists, totalCount };
}

/** Top tracks in a UTC calendar month window (for Explore visual anchors). */
export type TimeMachineExploreAnchorTrackRow = Readonly<{
  track_id: string;
  title: string;
  artist_name: string;
  plays: number;
  album_id: string | null;
  album_title: string | null;
  lastfm_cover_image_url: string | null;
}>;

/** Top albums in a UTC calendar month window (for Explore visual anchors). */
export type TimeMachineExploreAnchorAlbumRow = Readonly<{
  album_id: string;
  title: string;
  artist_name: string;
  plays: number;
  lastfm_cover_image_url: string | null;
}>;

/**
 * Ranked tracks with best-effort cover URLs for the Musical Time Machine Explore surface.
 * Window is half-open `[gteIso, ltExclusiveIso)` aligned with {@link utcCalendarMonthBoundsIso}.
 */
export async function listUserTimeMachineMonthTopTracksForExploreAnchors(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{
    userId: string;
    gteIso: string;
    ltExclusiveIso: string;
    limit: number;
  }>,
): Promise<TimeMachineExploreAnchorTrackRow[]> {
  const { rows } = await db.query<{
    track_id: string;
    title: string;
    artist_name: string;
    plays: number;
    album_id: string | null;
    album_title: string | null;
    lastfm_cover_image_url: string | null;
  }>(
    `select t.id::text as track_id,
            t.title,
            ${ARTIST_DISPLAY_TOP_TRACK_SQL} as artist_name,
            count(*)::int as plays,
            max(t.album_id::text) as album_id,
            max(${RECENT_LISTEN_ALBUM_TITLE_SQL}) as album_title,
            max(${LASTFM_COVER_IMAGE_URL_SQL}) as lastfm_cover_image_url
       from listens l
       join tracks t on t.id = l.track_id
       join artists ar_track on ar_track.id = t.artist_id
       left join albums al on al.id = t.album_id
       left join artists ar_album on ar_album.id = al.artist_id
       left join raw_scrobbles rs on rs.id = l.raw_scrobble_id
      where l.user_id = $1::uuid
        and l.played_at >= $2::timestamptz
        and l.played_at < $3::timestamptz
      group by t.id, t.title, ar_track.name, ar_album.name
      order by plays desc, t.title asc
      limit $4::int`,
    [input.userId, input.gteIso, input.ltExclusiveIso, input.limit],
  );
  return rows.map((r) => ({
    track_id: r.track_id,
    title: r.title,
    artist_name: r.artist_name,
    plays: r.plays,
    album_id: r.album_id,
    album_title: r.album_title,
    lastfm_cover_image_url: r.lastfm_cover_image_url,
  }));
}

export async function listUserTimeMachineMonthTopAlbumsForExploreAnchors(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{
    userId: string;
    gteIso: string;
    ltExclusiveIso: string;
    limit: number;
  }>,
): Promise<TimeMachineExploreAnchorAlbumRow[]> {
  const { rows } = await db.query<{
    album_id: string;
    title: string;
    artist_name: string;
    plays: number;
    lastfm_cover_image_url: string | null;
  }>(
    `select al.id::text as album_id,
            al.title,
            ${ARTIST_DISPLAY_TOP_ALBUM_SQL} as artist_name,
            count(*)::int as plays,
            max(${LASTFM_COVER_IMAGE_URL_SQL}) as lastfm_cover_image_url
       from listens l
       join tracks t on t.id = l.track_id
       join albums al on al.id = t.album_id
       join artists ar on ar.id = al.artist_id
       join artists ar_track on ar_track.id = t.artist_id
       left join raw_scrobbles rs on rs.id = l.raw_scrobble_id
      where l.user_id = $1::uuid
        and t.album_id is not null
        and l.played_at >= $2::timestamptz
        and l.played_at < $3::timestamptz
      group by al.id, al.title
      order by plays desc, al.title asc
      limit $4::int`,
    [input.userId, input.gteIso, input.ltExclusiveIso, input.limit],
  );
  return rows.map((r) => ({
    album_id: r.album_id,
    title: r.title,
    artist_name: r.artist_name,
    plays: r.plays,
    lastfm_cover_image_url: r.lastfm_cover_image_url,
  }));
}
