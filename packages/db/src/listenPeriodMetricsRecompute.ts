import type { Pool, PoolClient } from "pg";

import { HOME_BRIEFING_SNAPSHOT_KIND } from "./homeBriefingSnapshot.js";
import { pgTimestamptzToIsoString } from "./pgTimestamptz.js";
import { refreshUserListenDailyMetricsForUser } from "./userListenDailyMetricsRecompute.js";

type PoolWithConnect = Pick<Pool, "connect">;

/** Session temp: denormalized listens (+ track fields) for period rollups. */
export const LISTEN_PERIOD_RECOMPUTE_SRC = "tmp_listen_period_recompute_src" as const;

export type ListenPeriodMetricsRecomputeMode = "incremental" | "full";

export type ListenPeriodMetricsRecomputeOptions = Readonly<{
  mode?: ListenPeriodMetricsRecomputeMode;
}>;

/**
 * @param listenTimeScopeSql — optional `and …` fragment (UTC) restricting rows from the temp
 *   listen source, e.g. current open week only. Empty = all rows in temp (full recompute).
 */
function periodMetricsInsertFromDenormalizedListenSrcSql(
  periodKind: "calendar_week" | "calendar_month" | "calendar_year",
  dateTruncField: "week" | "month" | "year",
  listenTimeScopeSql: string = "",
): string {
  return `
insert into user_listen_period_metrics (
  user_id,
  period_kind,
  period_start,
  play_count,
  unique_track_count,
  unique_artist_count,
  unique_album_count,
  top_artist_id,
  top_artist_name,
  top_artist_plays,
  top_track_id,
  top_track_title,
  top_track_plays,
  computed_at
)
with src as (
  select *
    from ${LISTEN_PERIOD_RECOMPUTE_SRC} l
   where true
         ${listenTimeScopeSql}
),
base as (
  select
    l.user_id,
    date_trunc('${dateTruncField}', l.played_at)::date as period_start,
    count(*)::int as play_count,
    count(distinct l.track_id)::int as unique_track_count,
    count(distinct l.artist_id)::int as unique_artist_count,
    count(distinct l.album_id) filter (where l.album_id is not null)::int as unique_album_count
  from src l
  group by l.user_id, date_trunc('${dateTruncField}', l.played_at)::date
),
artist_counts as (
  select
    l.user_id,
    date_trunc('${dateTruncField}', l.played_at)::date as period_start,
    l.artist_id,
    max(a.name) as artist_name,
    count(*)::int as plays
  from src l
  inner join artists a on a.id = l.artist_id
  group by l.user_id, date_trunc('${dateTruncField}', l.played_at)::date, l.artist_id
),
artist_top as (
  select distinct on (user_id, period_start)
    user_id,
    period_start,
    artist_id,
    artist_name,
    plays
  from artist_counts
  order by user_id, period_start, plays desc, artist_name asc
),
track_counts as (
  select
    l.user_id,
    date_trunc('${dateTruncField}', l.played_at)::date as period_start,
    l.track_id,
    max(l.track_title) as track_title,
    count(*)::int as plays
  from src l
  group by l.user_id, date_trunc('${dateTruncField}', l.played_at)::date, l.track_id
),
track_top as (
  select distinct on (user_id, period_start)
    user_id,
    period_start,
    track_id,
    track_title,
    plays
  from track_counts
  order by user_id, period_start, plays desc, track_title asc
)
select
  b.user_id,
  '${periodKind}'::text,
  b.period_start,
  b.play_count,
  b.unique_track_count,
  b.unique_artist_count,
  b.unique_album_count,
  aa.artist_id,
  aa.artist_name,
  aa.plays,
  tt.track_id,
  tt.track_title,
  tt.plays,
  now()
from base b
left join artist_top aa
  on aa.user_id = b.user_id and aa.period_start = b.period_start
left join track_top tt
  on tt.user_id = b.user_id and tt.period_start = b.period_start`;
}

const INCREMENTAL_OPEN_WEEK_SCOPE = `and l.played_at >= date_trunc('week', now())
         and l.played_at < date_trunc('week', now()) + interval '1 week'`;

const INCREMENTAL_OPEN_MONTH_SCOPE = `and l.played_at >= date_trunc('month', now())
         and l.played_at < date_trunc('month', now()) + interval '1 month'`;

const INCREMENTAL_OPEN_YEAR_SCOPE = `and l.played_at >= date_trunc('year', now())
         and l.played_at < date_trunc('year', now()) + interval '1 year'`;

async function ensureOpenBucketPlaceholderRow(
  client: PoolClient,
  userId: string,
  periodKind: "calendar_week" | "calendar_month" | "calendar_year",
  dateTruncField: "week" | "month" | "year",
): Promise<void> {
  await client.query(
    `insert into user_listen_period_metrics (
       user_id,
       period_kind,
       period_start,
       play_count,
       unique_track_count,
       unique_artist_count,
       unique_album_count,
       top_artist_id,
       top_artist_name,
       top_artist_plays,
       top_track_id,
       top_track_title,
       top_track_plays,
       computed_at
     )
     select $1::uuid,
            $2::text,
            date_trunc('${dateTruncField}', now())::date,
            0,
            0,
            0,
            0,
            null,
            null,
            null,
            null,
            null,
            null,
            now()
      where not exists (
        select 1
          from user_listen_period_metrics m
         where m.user_id = $1::uuid
           and m.period_kind = $2::text
           and m.period_start = date_trunc('${dateTruncField}', now())::date
      )`,
    [userId, periodKind],
  );
}

async function dropTempListenSrc(client: PoolClient): Promise<void> {
  await client.query(`drop table if exists ${LISTEN_PERIOD_RECOMPUTE_SRC}`);
}

async function createTempListenSrcForUserAllListens(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await dropTempListenSrc(client);
  await client.query(
    `create temp table ${LISTEN_PERIOD_RECOMPUTE_SRC} on commit drop as
     select l.user_id,
            l.played_at,
            l.track_id,
            t.artist_id,
            t.album_id,
            t.title as track_title
       from listens l
       inner join tracks t on t.id = l.track_id
      where l.user_id = $1::uuid`,
    [userId],
  );
}

/**
 * Listens overlapping the union of [current UTC week), [current month), [current year) so
 * week/month/year open buckets recompute correctly across year boundaries.
 */
async function createTempListenSrcForIncrementalOpenBuckets(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await dropTempListenSrc(client);
  await client.query(
    `create temp table ${LISTEN_PERIOD_RECOMPUTE_SRC} on commit drop as
     select l.user_id,
            l.played_at,
            l.track_id,
            t.artist_id,
            t.album_id,
            t.title as track_title
       from listens l
       inner join tracks t on t.id = l.track_id
      where l.user_id = $1::uuid
        and l.played_at >= least(
          date_trunc('week', now()),
          date_trunc('month', now()),
          date_trunc('year', now())
        )
        and l.played_at < greatest(
          date_trunc('week', now()) + interval '1 week',
          date_trunc('month', now()) + interval '1 month',
          date_trunc('year', now()) + interval '1 year'
        )`,
    [userId],
  );
}

async function insertArtistStatsFromTemp(client: PoolClient): Promise<void> {
  await client.query(
    `insert into user_artist_listen_stats (user_id, artist_id, first_played_at, last_played_at, play_count)
     select l.user_id,
            l.artist_id,
            min(l.played_at),
            max(l.played_at),
            count(*)::bigint
       from ${LISTEN_PERIOD_RECOMPUTE_SRC} l
      group by l.user_id, l.artist_id`,
  );
}

async function refreshUserArtistListenStatsFromAllListens(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await client.query(`delete from user_artist_listen_stats where user_id = $1::uuid`, [userId]);
  await client.query(
    `insert into user_artist_listen_stats (user_id, artist_id, first_played_at, last_played_at, play_count)
     select l.user_id,
            t.artist_id,
            min(l.played_at),
            max(l.played_at),
            count(*)::bigint
       from listens l
       inner join tracks t on t.id = l.track_id
      where l.user_id = $1::uuid
      group by l.user_id, t.artist_id`,
    [userId],
  );
}

async function deleteHomeBriefingSnapshot(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `delete from analytics_snapshots
     where user_id = $1::uuid and kind = $2`,
    [userId, HOME_BRIEFING_SNAPSHOT_KIND],
  );
}

async function recomputeListenPeriodMetricsFull(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await client.query(`delete from user_listen_period_metrics where user_id = $1::uuid`, [userId]);
  await client.query(`delete from user_artist_listen_stats where user_id = $1::uuid`, [userId]);
  await createTempListenSrcForUserAllListens(client, userId);
  await insertArtistStatsFromTemp(client);
  await client.query(periodMetricsInsertFromDenormalizedListenSrcSql("calendar_week", "week"));
  await client.query(periodMetricsInsertFromDenormalizedListenSrcSql("calendar_month", "month"));
  await client.query(periodMetricsInsertFromDenormalizedListenSrcSql("calendar_year", "year"));
  await refreshUserListenDailyMetricsForUser(client, userId);
}

async function recomputeListenPeriodMetricsIncremental(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await client.query(
    `delete from user_listen_period_metrics
      where user_id = $1::uuid
        and (
          (period_kind = 'calendar_year' and period_start = date_trunc('year', now())::date)
          or (period_kind = 'calendar_month' and period_start = date_trunc('month', now())::date)
          or (period_kind = 'calendar_week' and period_start = date_trunc('week', now())::date)
        )`,
    [userId],
  );
  await createTempListenSrcForIncrementalOpenBuckets(client, userId);
  await client.query(
    periodMetricsInsertFromDenormalizedListenSrcSql(
      "calendar_week",
      "week",
      INCREMENTAL_OPEN_WEEK_SCOPE,
    ),
  );
  await ensureOpenBucketPlaceholderRow(client, userId, "calendar_week", "week");
  await client.query(
    periodMetricsInsertFromDenormalizedListenSrcSql(
      "calendar_month",
      "month",
      INCREMENTAL_OPEN_MONTH_SCOPE,
    ),
  );
  await ensureOpenBucketPlaceholderRow(client, userId, "calendar_month", "month");
  await client.query(
    periodMetricsInsertFromDenormalizedListenSrcSql(
      "calendar_year",
      "year",
      INCREMENTAL_OPEN_YEAR_SCOPE,
    ),
  );
  await ensureOpenBucketPlaceholderRow(client, userId, "calendar_year", "year");
  await refreshUserArtistListenStatsFromAllListens(client, userId);
  await refreshUserListenDailyMetricsForUser(client, userId);
}

/**
 * Refreshes stored rollups for one user. **`incremental`** (default) replaces only the current
 * UTC `calendar_week`, `calendar_month`, and `calendar_year` rows (open buckets for “now”),
 * then rebuilds `user_artist_listen_stats` from all listens; all other buckets are unchanged.
 * **`full`** deletes and rebuilds every period bucket (use after explicit user request or
 * repair). When no `calendar_month` rows with `play_count > 0` exist yet, `incremental`
 * automatically runs a **full** bootstrap. If canonical listens span more UTC months than
 * populated month rollups, `incremental` upgrades to **full** (Explore timeline repair after a
 * mid-import rollup). Refreshes `user_listen_daily_metrics` from all listens. Clears
 * `home_briefing_v1`.
 */
export async function recomputeUserListenPeriodMetrics(
  pool: PoolWithConnect,
  userId: string,
  options?: ListenPeriodMetricsRecomputeOptions,
): Promise<void> {
  const requestedMode: ListenPeriodMetricsRecomputeMode = options?.mode ?? "incremental";
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local time zone 'UTC'");

    const { rows } = await client.query<{ x: boolean }>(
      `select exists(
         select 1
           from user_listen_period_metrics m
          where m.user_id = $1::uuid
            and m.period_kind = 'calendar_month'
            and m.play_count > 0
          limit 1
       ) as x`,
      [userId],
    );
    const hasAnyPeriodRow = rows[0]?.x === true;
    let effectiveMode: ListenPeriodMetricsRecomputeMode =
      requestedMode === "incremental" && !hasAnyPeriodRow ? "full" : requestedMode;

    /**
     * If a full rollup ran while only part of the import was in `listens` (or rows were deleted),
     * incremental would forever refresh only the current UTC week/month/year. The Explore timeline
     * reads `calendar_month` buckets — when distinct listen months outnumber populated month
     * rows, rebuild everything.
     */
    if (effectiveMode === "incremental") {
      const { rows: covRows } = await client.query<{ listen_months: string; rollup_months: string }>(
        `select
           coalesce(
             (
               select count(*)::text
                 from (
                   select 1
                     from listens l
                    where l.user_id = $1::uuid
                    group by (date_trunc('month', l.played_at))::date
                  ) u
             ),
             '0'
           ) as listen_months,
           coalesce(
             (
               select count(*)::text
                 from user_listen_period_metrics m
                where m.user_id = $1::uuid
                  and m.period_kind = 'calendar_month'
                  and m.play_count > 0
             ),
             '0'
           ) as rollup_months`,
        [userId],
      );
      const listenMonths = Number(covRows[0]?.listen_months ?? "0");
      const rollupMonths = Number(covRows[0]?.rollup_months ?? "0");
      if (
        Number.isFinite(listenMonths) &&
        Number.isFinite(rollupMonths) &&
        listenMonths > rollupMonths
      ) {
        effectiveMode = "full";
      }
    }

    if (effectiveMode === "full") {
      await recomputeListenPeriodMetricsFull(client, userId);
    } else {
      await recomputeListenPeriodMetricsIncremental(client, userId);
    }

    await deleteHomeBriefingSnapshot(client, userId);
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

export type DominantCanonicalArtistRow = Readonly<{
  artist_id: string;
  name: string;
  plays: number;
}>;

export async function queryDominantCanonicalArtistInPlayedAtRange(
  pool: Pick<Pool, "query">,
  input: Readonly<{
    userId: string;
    playedAtLowerInclusive: Date;
    playedAtUpperInclusive: Date;
  }>,
): Promise<DominantCanonicalArtistRow | null> {
  const { rows } = await pool.query<{
    artist_id: string;
    name: string;
    plays: unknown;
  }>(
    `select t.artist_id,
            max(a.name) as name,
            count(*)::int as plays
       from listens l
       inner join tracks t on t.id = l.track_id
       inner join artists a on a.id = t.artist_id
      where l.user_id = $1::uuid
        and l.played_at >= $2::timestamptz
        and l.played_at <= $3::timestamptz
      group by t.artist_id
      order by plays desc, name asc
      limit 1`,
    [input.userId, input.playedAtLowerInclusive, input.playedAtUpperInclusive],
  );
  const r = rows[0];
  if (!r) {
    return null;
  }
  const plays = typeof r.plays === "number" ? r.plays : Number(r.plays);
  if (!Number.isFinite(plays) || plays < 1) {
    return null;
  }
  return { artist_id: r.artist_id, name: r.name, plays };
}

export async function queryArtistLastListenPlayedAtBefore(
  pool: Pick<Pool, "query">,
  input: Readonly<{ userId: string; artistId: string; before: Date }>,
): Promise<string | null> {
  const { rows } = await pool.query<{ last_at: unknown }>(
    `select max(l.played_at) as last_at
       from listens l
       inner join tracks t on t.id = l.track_id
      where l.user_id = $1::uuid
        and t.artist_id = $2::uuid
        and l.played_at < $3::timestamptz`,
    [input.userId, input.artistId, input.before],
  );
  const v = rows[0]?.last_at;
  return v == null ? null : pgTimestamptzToIsoString(v);
}

export type BriefingReturnAfterGapInsight = Readonly<{
  artistName: string;
  approxDays: number;
}>;

/**
 * Dominant artist in the window plus their last listen strictly before the window start — one
 * round trip for the home briefing “return after gap” line.
 */
export async function queryBriefingReturnAfterGapInsight(
  pool: Pick<Pool, "query">,
  input: Readonly<{
    userId: string;
    playedAtLowerInclusive: Date;
    playedAtUpperInclusive: Date;
    minDominantPlays: number;
    minGapMs: number;
  }>,
): Promise<BriefingReturnAfterGapInsight | null> {
  const { rows } = await pool.query<{
    artist_name: string;
    last_before: unknown;
    plays: unknown;
  }>(
    `with ranked as (
       select t.artist_id,
              max(a.name) as artist_name,
              count(*)::int as plays
         from listens l
         inner join tracks t on t.id = l.track_id
         inner join artists a on a.id = t.artist_id
        where l.user_id = $1::uuid
          and l.played_at >= $2::timestamptz
          and l.played_at <= $3::timestamptz
        group by t.artist_id
        order by plays desc, artist_name asc
        limit 1
     ),
     top as (select * from ranked where plays >= $4::int)
     select top.artist_name,
            top.plays,
            (select max(l.played_at)
               from listens l
               inner join tracks t on t.id = l.track_id
              where l.user_id = $1::uuid
                and t.artist_id = top.artist_id
                and l.played_at < $2::timestamptz
            ) as last_before
       from top`,
    [
      input.userId,
      input.playedAtLowerInclusive,
      input.playedAtUpperInclusive,
      input.minDominantPlays,
    ],
  );
  const r = rows[0];
  if (!r?.last_before) {
    return null;
  }
  const lastIso = pgTimestamptzToIsoString(r.last_before);
  const gapMs = input.playedAtLowerInclusive.getTime() - Date.parse(lastIso);
  if (!Number.isFinite(gapMs) || gapMs < input.minGapMs) {
    return null;
  }
  const plays = typeof r.plays === "number" ? r.plays : Number(r.plays);
  if (!Number.isFinite(plays) || plays < input.minDominantPlays) {
    return null;
  }
  const approxDays = Math.round(gapMs / 86_400_000);
  return { artistName: r.artist_name, approxDays };
}
