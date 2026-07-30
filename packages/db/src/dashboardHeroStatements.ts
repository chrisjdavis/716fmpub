/**
 * Parameterized SQL for dashboard hero-window aggregates. Shared with plan-audit tests
 * so `EXPLAIN` targets the same text {@link ./dashboardAnalytics.js} executes.
 */

export type HeroWeekdayPeakStatementSpec = Readonly<{
  tag: "hero_weekday_peak";
  text: string;
  values: unknown[];
}>;

/**
 * @param calendarTimeZone PostgreSQL `AT TIME ZONE` zone name (`UTC`, `America/New_York`, …).
 *        Must be a valid server-side zone string; callers should validate before querying.
 */
export function buildHeroWeekdayPeakStatementSpec(
  userId: string,
  since: Date | null,
  calendarTimeZone: string = "UTC",
): HeroWeekdayPeakStatementSpec {
  if (since) {
    return {
      tag: "hero_weekday_peak",
      text: `select extract(dow from (l.played_at at time zone $3::text))::int as utc_weekday,
                count(*)::int as plays
           from listens l
          where l.user_id = $1::uuid
            and l.played_at >= $2::timestamptz
          group by 1
          order by plays desc, utc_weekday asc
          limit 1`,
      values: [userId, since, calendarTimeZone],
    };
  }
  return {
    tag: "hero_weekday_peak",
    text: `select extract(dow from (l.played_at at time zone $2::text))::int as utc_weekday,
                count(*)::int as plays
           from listens l
          where l.user_id = $1::uuid
          group by 1
          order by plays desc, utc_weekday asc
          limit 1`,
    values: [userId, calendarTimeZone],
  };
}

export type HeroTimelineMonthlyStatementSpec = Readonly<{
  tag: "hero_timeline_monthly_all";
  text: string;
  values: unknown[];
}>;

/** “All time” hero timeline: monthly buckets, last 60 months (same as production). */
export function buildHeroTimelineMonthlyAllStatementSpec(userId: string): HeroTimelineMonthlyStatementSpec {
  return {
    tag: "hero_timeline_monthly_all",
    text: `with months as (
        select date_trunc('month', l.played_at at time zone 'utc') as m,
               count(*)::int as c
          from listens l
         where l.user_id = $1::uuid
         group by 1
     ),
     t as (
        select m, c from months order by m desc limit 60
     )
     select to_char(m, 'YYYY-MM-DD') as period_start,
            c as count
       from t
      order by m asc`,
    values: [userId],
  };
}
