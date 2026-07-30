import type { Pool, PoolClient } from "pg";

import { coalesceStatsRollupTimeZoneIANA } from "./statsRollupTimeZone.js";

/**
 * Rebuilds all `user_listen_daily_metrics` rows for one user from `listens`, bucketing by
 * civil date in {@link coalesceStatsRollupTimeZoneIANA `users.stats_timezone`} (null → UTC).
 */
export async function refreshUserListenDailyMetricsForUser(
  client: PoolClient,
  userId: string,
): Promise<void> {
  const { rows } = await client.query<{ stats_timezone: string | null }>(
    `select stats_timezone from users where id = $1::uuid limit 1`,
    [userId],
  );
  const tz = coalesceStatsRollupTimeZoneIANA(rows[0]?.stats_timezone);

  await client.query(`delete from user_listen_daily_metrics where user_id = $1::uuid`, [userId]);

  await client.query(
    `
with listens_local as (
  select
    l.user_id,
    l.played_at,
    l.track_id,
    t.artist_id,
    t.album_id,
    (l.played_at at time zone $2::text)::date as cal_day,
    extract(hour from (l.played_at at time zone $2::text))::int as local_h
    from listens l
    inner join tracks t on t.id = l.track_id
   where l.user_id = $1::uuid
),
day_base as (
  select
    user_id,
    cal_day as calendar_day,
    count(*)::int as play_count,
    count(distinct track_id)::int as distinct_tracks,
    count(distinct artist_id)::int as distinct_artists,
    count(distinct album_id) filter (where album_id is not null)::int as distinct_albums,
    min(played_at) as first_listen_at,
    max(played_at) as last_listen_at
    from listens_local
   group by user_id, cal_day
),
artist_day as (
  select user_id, cal_day as calendar_day, artist_id, count(*)::int as plays
    from listens_local
   group by user_id, cal_day, artist_id
),
artist_top as (
  select distinct on (user_id, calendar_day)
    user_id,
    calendar_day,
    artist_id as top_artist_id,
    plays as top_artist_plays
    from artist_day
   order by user_id, calendar_day, plays desc, artist_id asc
),
track_day as (
  select user_id, cal_day as calendar_day, track_id, count(*)::int as plays
    from listens_local
   group by user_id, cal_day, track_id
),
track_top as (
  select distinct on (user_id, calendar_day)
    user_id,
    calendar_day,
    track_id as top_track_id,
    plays as top_track_plays
    from track_day
   order by user_id, calendar_day, plays desc, track_id asc
),
hour_counts as (
  select user_id, cal_day as calendar_day, local_h, count(*)::int as c
    from listens_local
   group by user_id, cal_day, local_h
),
hour_peak as (
  select distinct on (user_id, calendar_day)
    user_id,
    calendar_day,
    local_h::smallint as peak_hour_bucket
    from hour_counts
   order by user_id, calendar_day, c desc, local_h asc
)
insert into user_listen_daily_metrics (
  user_id,
  calendar_day,
  play_count,
  distinct_tracks,
  distinct_artists,
  distinct_albums,
  top_artist_id,
  top_artist_plays,
  top_track_id,
  top_track_plays,
  first_listen_at,
  last_listen_at,
  peak_hour_bucket,
  computed_at
)
select
  b.user_id,
  b.calendar_day,
  b.play_count,
  b.distinct_tracks,
  b.distinct_artists,
  b.distinct_albums,
  at.top_artist_id,
  at.top_artist_plays,
  tt.top_track_id,
  tt.top_track_plays,
  b.first_listen_at,
  b.last_listen_at,
  hp.peak_hour_bucket,
  now()
  from day_base b
  left join artist_top at
    on at.user_id = b.user_id and at.calendar_day = b.calendar_day
  left join track_top tt
    on tt.user_id = b.user_id and tt.calendar_day = b.calendar_day
  left join hour_peak hp
    on hp.user_id = b.user_id and hp.calendar_day = b.calendar_day`,
    [userId, tz],
  );
}

/**
 * Rebuilds `user_listen_daily_metrics` from `listens` in one transaction (same logic as the
 * analytics `listen_period_metrics` job). Use when period/artist rollups already exist but the
 * daily table was never backfilled, so the app does not rely on a worker consuming BullMQ.
 */
export async function backfillUserListenDailyMetricsFromListens(
  pool: Pick<Pool, "connect">,
  userId: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local time zone 'UTC'");
    await refreshUserListenDailyMetricsForUser(client, userId);
    await client.query("commit");
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}
