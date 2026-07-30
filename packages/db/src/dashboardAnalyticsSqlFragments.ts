/**
 * Shared SQL fragments for dashboard analytics. Kept in one module so
 * {@link ./dashboardListenSummaryStatements.js} and {@link ./dashboardAnalytics.js}
 * cannot drift on cover-art / display credit expressions.
 */

export const ARTIST_DISPLAY_TOP_TRACK_SQL = `coalesce(
  nullif(btrim(ar_track.name), ''),
  nullif(btrim(ar_album.name), ''),
  max(nullif(btrim(rs.artist_name), '')),
  ''
)`;

export const ARTIST_DISPLAY_TOP_ALBUM_SQL = `coalesce(
  nullif(btrim(max(ar.name)), ''),
  nullif(btrim(max(ar_track.name)), ''),
  max(nullif(btrim(rs.artist_name), '')),
  ''
)`;

/** Best-effort Last.fm image URL from `raw_scrobbles.raw_payload` (album `image[]`, then track). */
export const LASTFM_COVER_IMAGE_URL_SQL = `(
  with elems as (
    select elem from jsonb_array_elements(
      case jsonb_typeof(rs.raw_payload->'album')
        when 'object' then
          case jsonb_typeof((rs.raw_payload->'album')->'image')
            when 'array' then (rs.raw_payload->'album')->'image'
            else '[]'::jsonb
          end
        else '[]'::jsonb
      end
    ) elem
    union all
    select elem from jsonb_array_elements(
      case jsonb_typeof(rs.raw_payload->'image')
        when 'array' then rs.raw_payload->'image'
        else '[]'::jsonb
      end
    ) elem
  ),
  ranked as (
    select
      nullif(btrim(elem->>'#text'), '') as u,
      case lower(coalesce(elem->>'size', ''))
        when 'mega' then 0
        when 'extralarge' then 1
        when 'large' then 2
        when 'medium' then 3
        when 'small' then 4
        else 5
      end as rk
    from elems
    where jsonb_typeof(elem) = 'object'
  )
  select u from ranked where u is not null order by rk asc limit 1
)`;

export const TOP_TRACK_RELEASE_MBID_SQL = `nullif(
  btrim(coalesce(
    nullif(btrim(max(al.musicbrainz_release_mbid)), ''),
    nullif(btrim(max(rs.album_mbid)), '')
  )),
  ''
)`;

export const TOP_ALBUM_RELEASE_MBID_SQL = `nullif(
  btrim(coalesce(
    nullif(btrim(max(al.musicbrainz_release_mbid)), ''),
    nullif(btrim(max(rs.album_mbid)), '')
  )),
  ''
)`;

/** Canonical listen row: track + album artist + optional Last.fm scrobble artist string. */
export const RECENT_LISTEN_ARTIST_DISPLAY_SQL = `coalesce(
  nullif(btrim(ar_track.name), ''),
  nullif(btrim(ar_album.name), ''),
  nullif(btrim(rs.artist_name), ''),
  ''
)`;

/** Canonical listen row: `albums.title` else per-scrobble album name. */
export const RECENT_LISTEN_ALBUM_TITLE_SQL = `nullif(
  btrim(coalesce(nullif(btrim(al.title), ''), nullif(btrim(rs.album_name), ''))),
  ''
)`;

export const RECENT_LISTEN_RELEASE_MBID_SQL = `nullif(
  btrim(coalesce(nullif(btrim(al.musicbrainz_release_mbid), ''), nullif(btrim(rs.album_mbid), ''))),
  ''
)`;
