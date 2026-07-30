import {
  ARTIST_DISPLAY_TOP_ALBUM_SQL,
  ARTIST_DISPLAY_TOP_TRACK_SQL,
  LASTFM_COVER_IMAGE_URL_SQL,
  TOP_ALBUM_RELEASE_MBID_SQL,
  TOP_TRACK_RELEASE_MBID_SQL,
} from "./dashboardAnalyticsSqlFragments.js";

/**
 * Predicate on `listens.played_at` for dashboard windows:
 * `$2` = lower bound or null (no lower), `$3` = exclusive upper bound or null (no upper).
 */
export const LISTEN_SUMMARY_PLAYED_AT_RANGE_SQL =
  "( ($2::timestamptz is null or l.played_at >= $2::timestamptz) and ($3::timestamptz is null or l.played_at < $3::timestamptz) )";

export type DashboardListenSummaryStatementTag =
  | "listen_summary_total"
  | "listen_summary_top_artists"
  | "listen_summary_top_tracks"
  | "listen_summary_top_albums";

export type DashboardListenSummaryStatementSpec = Readonly<{
  tag: DashboardListenSummaryStatementTag;
  text: string;
  values: unknown[];
}>;

/**
 * Parameterized SQL for the four statements executed by {@link ./dashboardAnalytics.js#getDashboardListenSummary}.
 * Tests run `EXPLAIN` on these specs so plans cannot silently diverge from production.
 */
export function buildDashboardListenSummaryStatementSpecs(input: {
  userId: string;
  since: Date | null;
  untilExclusive: Date | null;
  topLimit: number;
}): readonly DashboardListenSummaryStatementSpec[] {
  const baseParams: unknown[] = [input.userId, input.since, input.untilExclusive];
  const topParams: unknown[] = [...baseParams, input.topLimit];
  const rangeClause = LISTEN_SUMMARY_PLAYED_AT_RANGE_SQL;

  return [
    {
      tag: "listen_summary_total",
      text: `select count(*)::int as c
       from listens l
       where l.user_id = $1::uuid
         and ${rangeClause}`,
      values: baseParams,
    },
    {
      tag: "listen_summary_top_artists",
      text: `with labeled as (
         select
           l.played_at,
           coalesce(
             nullif(btrim(rs.artist_name), ''),
             nullif(btrim(a.name), '')
           ) as display_artist
         from listens l
         join tracks t on t.id = l.track_id
         join artists a on a.id = t.artist_id
         left join raw_scrobbles rs on rs.id = l.raw_scrobble_id
         where l.user_id = $1::uuid
           and ${rangeClause}
       ),
       bucketed as (
         select
           played_at,
           display_artist,
           lower(regexp_replace(trim(display_artist), '[[:space:]]+', ' ', 'g')) as artist_key
         from labeled
         where nullif(trim(display_artist), '') is not null
       )
       select md5(artist_key)::text as artist_id,
              (array_agg(display_artist order by played_at desc))[1] as name,
              count(*)::int as plays
       from bucketed
       where nullif(artist_key, '') is not null
       group by artist_key
       order by plays desc, name asc
       limit $4::int`,
      values: topParams,
    },
    {
      tag: "listen_summary_top_tracks",
      text: `select t.id as track_id,
              t.title,
              ${ARTIST_DISPLAY_TOP_TRACK_SQL} as artist_name,
              count(*)::int as plays,
              ${TOP_TRACK_RELEASE_MBID_SQL} as musicbrainz_release_mbid,
              max(${LASTFM_COVER_IMAGE_URL_SQL}) as lastfm_cover_image_url
       from listens l
       join tracks t on t.id = l.track_id
       join artists ar_track on ar_track.id = t.artist_id
       left join albums al on al.id = t.album_id
       left join artists ar_album on ar_album.id = al.artist_id
       left join raw_scrobbles rs on rs.id = l.raw_scrobble_id
       where l.user_id = $1::uuid
         and ${rangeClause}
       group by t.id, t.title, ar_track.name, ar_album.name
       order by plays desc, t.title asc
       limit $4::int`,
      values: topParams,
    },
    {
      tag: "listen_summary_top_albums",
      text: `select al.id as album_id,
              al.title,
              ${ARTIST_DISPLAY_TOP_ALBUM_SQL} as artist_name,
              count(*)::int as plays,
              ${TOP_ALBUM_RELEASE_MBID_SQL} as musicbrainz_release_mbid,
              max(${LASTFM_COVER_IMAGE_URL_SQL}) as lastfm_cover_image_url
       from listens l
       join tracks t on t.id = l.track_id
       join albums al on al.id = t.album_id
       join artists ar on ar.id = al.artist_id
       join artists ar_track on ar_track.id = t.artist_id
       left join raw_scrobbles rs on rs.id = l.raw_scrobble_id
       where l.user_id = $1::uuid
         and t.album_id is not null
         and ${rangeClause}
       group by al.id, al.title
       order by plays desc, al.title asc
       limit $4::int`,
      values: topParams,
    },
  ] as const;
}
