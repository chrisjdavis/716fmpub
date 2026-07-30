import type { Pool } from "pg";

export type UserListenStatsFoundationReadiness = Readonly<{
  hasListens: boolean;
  periodRollupsPopulated: boolean;
  artistRollupsPopulated: boolean;
  dailyMetricsPopulated: boolean;
}>;

/**
 * Whether canonical listens exist and whether rollup tables already have usable month rows
 * (`calendar_month` with `play_count > 0`) for the user.
 * Used to decide when to enqueue analytics jobs and show a “building stats” dashboard message.
 */
export async function getUserListenStatsFoundationReadiness(
  db: Pick<Pool, "query">,
  userId: string,
): Promise<UserListenStatsFoundationReadiness> {
  const { rows } = await db.query<{
    has_listens: boolean;
    period_rollups: boolean;
    artist_rollups: boolean;
    daily_metrics: boolean;
  }>(
    `select
       exists(select 1 from listens l where l.user_id = $1::uuid limit 1) as has_listens,
       exists(
         select 1
           from user_listen_period_metrics m
          where m.user_id = $1::uuid
            and m.period_kind = 'calendar_month'
            and m.play_count > 0
          limit 1
       ) as period_rollups,
       exists(
         select 1 from user_artist_listen_stats s where s.user_id = $1::uuid limit 1
       ) as artist_rollups,
       exists(
         select 1 from user_listen_daily_metrics d where d.user_id = $1::uuid limit 1
       ) as daily_metrics`,
    [userId],
  );
  const r = rows[0];
  return {
    hasListens: r?.has_listens === true,
    periodRollupsPopulated: r?.period_rollups === true,
    artistRollupsPopulated: r?.artist_rollups === true,
    dailyMetricsPopulated: r?.daily_metrics === true,
  };
}
