import {
  getEarliestListenPlayedAtForUser,
  playedAtLowerBoundUtc,
  type DashboardAnalyticsDbExecutor,
  type DashboardAnalyticsRange,
} from "./dashboardAnalytics.js";
import { ARTIST_USER_RELATIONSHIP_DORMANT_GAP_MS } from "@vs/domain";
import { replaceUpsertAnalyticsSnapshot } from "./analyticsSnapshotsUpsert.js";
import { coalesceStatsRollupTimeZoneIANA } from "./statsRollupTimeZone.js";
import { getUserProfileFields } from "./userProfile.js";

export const USER_WINDOW_SIGNALS_SNAPSHOT_KIND = "user_window_signals_v1" as const;

const USER_WINDOW_SIGNALS_SCHEMA_VERSION = 1 as const;

const MS_PER_DAY = 86_400_000;

export type UserWindowSignalsDaypart = "morning" | "afternoon" | "evening" | "night";

export type UserWindowSignalsArtistPlays = Readonly<{
  artist_id: string;
  plays: number;
}>;

export type UserWindowSignalsRangeSlot = Readonly<{
  window_start_iso: string;
  window_end_iso: string;
  play_count: number;
  distinct_artists: number;
  distinct_tracks: number;
  top_artist_id: string | null;
  top_artist_plays: number | null;
  previous_play_count: number | null;
  delta_absolute: number | null;
  delta_percent: number | null;
  previous_distinct_artists: number | null;
  repeat_ratio: number | null;
  discovery_ratio: number | null;
  peak_weekday: number | null;
  weekday_distribution: readonly number[];
  peak_daypart: UserWindowSignalsDaypart | null;
  consistency_score: number | null;
  new_artists: readonly UserWindowSignalsArtistPlays[];
  returning_artists: readonly UserWindowSignalsArtistPlays[];
  spiking_artists: readonly UserWindowSignalsArtistPlays[];
}>;

export type UserWindowSignalsSnapshotBodyV1 = Readonly<{
  schema_version: typeof USER_WINDOW_SIGNALS_SCHEMA_VERSION;
  as_of: string;
  stats_timezone: string;
  ranges: Record<DashboardAnalyticsRange, UserWindowSignalsRangeSlot>;
}>;

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object";
}

export function parseUserWindowSignalsSnapshotBodyV1(raw: unknown): UserWindowSignalsSnapshotBodyV1 | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.schema_version !== USER_WINDOW_SIGNALS_SCHEMA_VERSION) {
    return null;
  }
  if (typeof raw.as_of !== "string" || raw.as_of.trim() === "") {
    return null;
  }
  if (typeof raw.stats_timezone !== "string" || raw.stats_timezone.trim() === "") {
    return null;
  }
  const rangesRaw = raw.ranges;
  if (rangesRaw === null || typeof rangesRaw !== "object") {
    return null;
  }
  const ro = rangesRaw as Record<string, unknown>;
  for (const key of ["7d", "30d", "90d", "all"] as const) {
    if (!(key in ro) || ro[key] === null || typeof ro[key] !== "object") {
      return null;
    }
  }
  return raw as unknown as UserWindowSignalsSnapshotBodyV1;
}

/** Normalized Shannon entropy of weekday counts (0 = one day, 1 = spread across the week). */
export function consistencyScoreFromWeekdayCounts(counts: readonly number[]): number | null {
  if (counts.length !== 7) {
    return null;
  }
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    return null;
  }
  let h = 0;
  for (const c of counts) {
    if (c <= 0) {
      continue;
    }
    const p = c / sum;
    h -= p * Math.log(p);
  }
  const maxH = Math.log(7);
  return maxH > 0 ? Math.min(1, h / maxH) : null;
}

function rollingDaysForRange(range: DashboardAnalyticsRange): number | null {
  if (range === "7d") {
    return 7;
  }
  if (range === "30d") {
    return 30;
  }
  if (range === "90d") {
    return 90;
  }
  return null;
}

function peakDaypartFromCounts(m: {
  morning: number;
  afternoon: number;
  evening: number;
  night: number;
}): UserWindowSignalsDaypart | null {
  const entries: readonly [UserWindowSignalsDaypart, number][] = [
    ["morning", m.morning],
    ["afternoon", m.afternoon],
    ["evening", m.evening],
    ["night", m.night],
  ];
  let best: UserWindowSignalsDaypart | null = null;
  let bestN = -1;
  for (const [k, v] of entries) {
    if (v > bestN) {
      bestN = v;
      best = k;
    }
  }
  return bestN > 0 ? best : null;
}

async function queryBasics(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{
    userId: string;
    since: Date | null;
  }>,
): Promise<{ play_count: number; distinct_artists: number; distinct_tracks: number }> {
  const { rows } = await db.query<{ c: string; da: string; dt: string }>(
    `select count(*)::text as c,
            count(distinct t.artist_id)::text as da,
            count(distinct l.track_id)::text as dt
       from listens l
       join tracks t on t.id = l.track_id
      where l.user_id = $1::uuid
        and ($2::timestamptz is null or l.played_at >= $2::timestamptz)`,
    [input.userId, input.since],
  );
  const r = rows[0];
  return {
    play_count: Number(r?.c ?? 0),
    distinct_artists: Number(r?.da ?? 0),
    distinct_tracks: Number(r?.dt ?? 0),
  };
}

async function queryTopCanonicalArtist(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{ userId: string; since: Date | null }>,
): Promise<{ artist_id: string; plays: number } | null> {
  const { rows } = await db.query<{ artist_id: string; plays: number }>(
    `select t.artist_id::text as artist_id, count(*)::int as plays
       from listens l
       join tracks t on t.id = l.track_id
      where l.user_id = $1::uuid
        and ($2::timestamptz is null or l.played_at >= $2::timestamptz)
      group by t.artist_id
      order by plays desc, t.artist_id asc
      limit 1`,
    [input.userId, input.since],
  );
  const r = rows[0];
  return r ? { artist_id: r.artist_id, plays: r.plays } : null;
}

async function queryPreviousBasics(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{ userId: string; priorSince: Date; currentSince: Date }>,
): Promise<{ play_count: number; distinct_artists: number }> {
  const { rows } = await db.query<{ c: string; da: string }>(
    `select count(*)::text as c, count(distinct t.artist_id)::text as da
       from listens l
       join tracks t on t.id = l.track_id
      where l.user_id = $1::uuid
        and l.played_at >= $2::timestamptz
        and l.played_at < $3::timestamptz`,
    [input.userId, input.priorSince, input.currentSince],
  );
  const r = rows[0];
  return {
    play_count: Number(r?.c ?? 0),
    distinct_artists: Number(r?.da ?? 0),
  };
}

async function queryRepeatAndDiscovery(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{ userId: string; since: Date; nowEnd: Date }>,
): Promise<{ repeat_ratio: number | null; discovery_ratio: number | null }> {
  const { rows: tr } = await db.query<{ repeat_plays: string; total: string }>(
    `with track_c as (
       select l.track_id, count(*)::int as c
         from listens l
        where l.user_id = $1::uuid
          and l.played_at >= $2::timestamptz
        group by l.track_id
     )
     select coalesce(sum(case when c > 1 then c else 0 end), 0)::text as repeat_plays,
            coalesce(sum(c), 0)::text as total
       from track_c`,
    [input.userId, input.since],
  );
  const total = Number(tr[0]?.total ?? 0);
  const repeatPlays = Number(tr[0]?.repeat_plays ?? 0);
  const repeat_ratio = total > 0 ? repeatPlays / total : null;

  const { rows: dr } = await db.query<{ c: string }>(
    `with ap as (
       select t.artist_id, min(l.played_at) as first_at
         from listens l
         join tracks t on t.id = l.track_id
        where l.user_id = $1::uuid
        group by t.artist_id
     )
     select count(*)::text as c
       from listens l
       join tracks t on t.id = l.track_id
       join ap on ap.artist_id = t.artist_id
      where l.user_id = $1::uuid
        and l.played_at >= $2::timestamptz
        and ap.first_at >= $2::timestamptz
        and ap.first_at <= $3::timestamptz`,
    [input.userId, input.since, input.nowEnd],
  );
  const discPlays = Number(dr[0]?.c ?? 0);
  const discovery_ratio = total > 0 ? discPlays / total : null;

  return { repeat_ratio, discovery_ratio };
}

async function queryNewArtists(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{ userId: string; since: Date; nowEnd: Date }>,
): Promise<UserWindowSignalsArtistPlays[]> {
  const { rows } = await db.query<{ artist_id: string; plays: number }>(
    `with ap as (
       select t.artist_id, min(l.played_at) as first_at
         from listens l
         join tracks t on t.id = l.track_id
        where l.user_id = $1::uuid
        group by t.artist_id
     )
     select ap.artist_id::text as artist_id, count(*)::int as plays
       from listens l
       join tracks t on t.id = l.track_id
       join ap on ap.artist_id = t.artist_id
      where l.user_id = $1::uuid
        and l.played_at >= $2::timestamptz
        and ap.first_at >= $2::timestamptz
        and ap.first_at <= $3::timestamptz
      group by ap.artist_id
      order by plays desc, ap.artist_id asc
      limit 25`,
    [input.userId, input.since, input.nowEnd],
  );
  return rows.map((r) => ({ artist_id: r.artist_id, plays: r.plays }));
}

async function queryReturningArtists(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{ userId: string; since: Date }>,
): Promise<UserWindowSignalsArtistPlays[]> {
  const { rows } = await db.query<{ artist_id: string; plays: number }>(
    `with window_plays as (
       select t.artist_id, count(*)::int as plays
         from listens l
         join tracks t on t.id = l.track_id
        where l.user_id = $1::uuid
          and l.played_at >= $2::timestamptz
        group by t.artist_id
     ),
     last_before as (
       select t.artist_id, max(l.played_at) as last_at
         from listens l
         join tracks t on t.id = l.track_id
        where l.user_id = $1::uuid
          and l.played_at < $2::timestamptz
        group by t.artist_id
     )
     select wp.artist_id::text as artist_id, wp.plays
       from window_plays wp
       join last_before lb
         on lb.artist_id = wp.artist_id
      where lb.last_at < ($2::timestamptz - ($3::bigint * interval '1 millisecond'))
      order by wp.plays desc, wp.artist_id asc
      limit 25`,
    [input.userId, input.since, ARTIST_USER_RELATIONSHIP_DORMANT_GAP_MS],
  );
  return rows.map((r) => ({ artist_id: r.artist_id, plays: r.plays }));
}

async function querySpikingArtists(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{ userId: string; currentSince: Date; priorSince: Date }>,
): Promise<UserWindowSignalsArtistPlays[]> {
  const { rows } = await db.query<{ artist_id: string; plays: number }>(
    `with cur as (
       select t.artist_id, count(*)::int as plays
         from listens l
         join tracks t on t.id = l.track_id
        where l.user_id = $1::uuid
          and l.played_at >= $2::timestamptz
        group by t.artist_id
     ),
     prev as (
       select t.artist_id, count(*)::int as plays
         from listens l
         join tracks t on t.id = l.track_id
        where l.user_id = $1::uuid
          and l.played_at >= $3::timestamptz
          and l.played_at < $2::timestamptz
        group by t.artist_id
     )
     select cur.artist_id::text as artist_id, cur.plays
       from cur
       left join prev on prev.artist_id = cur.artist_id
      where cur.plays >= 5
        and coalesce(prev.plays, 0) >= 1
        and cur.plays::double precision >= 2.5 * prev.plays::double precision
      order by cur.plays desc, cur.artist_id asc
      limit 25`,
    [input.userId, input.currentSince, input.priorSince],
  );
  return rows.map((r) => ({ artist_id: r.artist_id, plays: r.plays }));
}

async function queryWeekdayAndDaypart(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{ userId: string; since: Date | null; tz: string }>,
): Promise<{
  weekday_distribution: readonly number[];
  peak_weekday: number | null;
  peak_daypart: UserWindowSignalsDaypart | null;
}> {
  const { rows: dowRows } = await db.query<{ dow: number; c: number }>(
    `select extract(dow from (l.played_at at time zone $2::text))::int as dow,
            count(*)::int as c
       from listens l
      where l.user_id = $1::uuid
        and ($3::timestamptz is null or l.played_at >= $3::timestamptz)
      group by 1`,
    [input.userId, input.tz, input.since],
  );
  const dist = [0, 0, 0, 0, 0, 0, 0];
  for (const r of dowRows) {
    if (r.dow >= 0 && r.dow <= 6) {
      dist[r.dow] = r.c;
    }
  }
  let peakDow: number | null = null;
  let peakC = -1;
  for (let d = 0; d < 7; d += 1) {
    if (dist[d] > peakC) {
      peakC = dist[d];
      peakDow = d;
    }
  }
  if (peakC <= 0) {
    peakDow = null;
  }

  const { rows: dpRows } = await db.query<{
    morning: string;
    afternoon: string;
    evening: string;
    night: string;
  }>(
    `with h as (
       select extract(hour from (l.played_at at time zone $2::text))::int as hh
         from listens l
        where l.user_id = $1::uuid
          and ($3::timestamptz is null or l.played_at >= $3::timestamptz)
     )
     select coalesce(sum(case when hh between 5 and 11 then 1 else 0 end), 0)::text as morning,
            coalesce(sum(case when hh between 12 and 17 then 1 else 0 end), 0)::text as afternoon,
            coalesce(sum(case when hh between 18 and 21 then 1 else 0 end), 0)::text as evening,
            coalesce(sum(case when hh >= 22 or hh <= 4 then 1 else 0 end), 0)::text as night
       from h`,
    [input.userId, input.tz, input.since],
  );
  const d0 = dpRows[0];
  const peak_daypart = d0
    ? peakDaypartFromCounts({
        morning: Number(d0.morning),
        afternoon: Number(d0.afternoon),
        evening: Number(d0.evening),
        night: Number(d0.night),
      })
    : null;

  return {
    weekday_distribution: dist,
    peak_weekday: peakDow,
    peak_daypart,
  };
}

async function computeSlot(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{
    userId: string;
    range: DashboardAnalyticsRange;
    nowMs: number;
    statsTz: string;
    earliestIso: string | null;
  }>,
): Promise<UserWindowSignalsRangeSlot> {
  const nowEnd = new Date(input.nowMs);
  const rollingDays = rollingDaysForRange(input.range);
  const since =
    input.range === "all"
      ? null
      : playedAtLowerBoundUtc(input.range, input.nowMs) ?? null;

  const window_start_iso =
    since !== null
      ? since.toISOString()
      : input.earliestIso ?? nowEnd.toISOString();
  const window_end_iso = nowEnd.toISOString();

  const basics = await queryBasics(db, { userId: input.userId, since });
  const top = await queryTopCanonicalArtist(db, { userId: input.userId, since });

  let previous_play_count: number | null = null;
  let previous_distinct_artists: number | null = null;
  let delta_absolute: number | null = null;
  let delta_percent: number | null = null;
  let repeat_ratio: number | null = null;
  let discovery_ratio: number | null = null;
  let new_artists: UserWindowSignalsArtistPlays[] = [];
  let returning_artists: UserWindowSignalsArtistPlays[] = [];
  let spiking_artists: UserWindowSignalsArtistPlays[] = [];

  if (since !== null && rollingDays !== null) {
    const priorSince = new Date(since.getTime() - rollingDays * MS_PER_DAY);
    const prev = await queryPreviousBasics(db, {
      userId: input.userId,
      priorSince,
      currentSince: since,
    });
    previous_play_count = prev.play_count;
    previous_distinct_artists = prev.distinct_artists;
    delta_absolute = basics.play_count - prev.play_count;
    if (prev.play_count > 0) {
      delta_percent = ((basics.play_count - prev.play_count) / prev.play_count) * 100;
    } else if (basics.play_count > 0) {
      delta_percent = null;
    } else {
      delta_percent = 0;
    }

    const rd = await queryRepeatAndDiscovery(db, {
      userId: input.userId,
      since,
      nowEnd,
    });
    repeat_ratio = rd.repeat_ratio;
    discovery_ratio = rd.discovery_ratio;

    new_artists = await queryNewArtists(db, { userId: input.userId, since, nowEnd });
    returning_artists = await queryReturningArtists(db, { userId: input.userId, since });
    spiking_artists = await querySpikingArtists(db, {
      userId: input.userId,
      currentSince: since,
      priorSince,
    });
  }

  const { weekday_distribution, peak_weekday, peak_daypart } = await queryWeekdayAndDaypart(db, {
    userId: input.userId,
    since,
    tz: input.statsTz,
  });
  const consistency_score = consistencyScoreFromWeekdayCounts(weekday_distribution);

  return {
    window_start_iso,
    window_end_iso,
    play_count: basics.play_count,
    distinct_artists: basics.distinct_artists,
    distinct_tracks: basics.distinct_tracks,
    top_artist_id: top?.artist_id ?? null,
    top_artist_plays: top?.plays ?? null,
    previous_play_count,
    delta_absolute,
    delta_percent,
    previous_distinct_artists,
    repeat_ratio,
    discovery_ratio,
    peak_weekday,
    weekday_distribution,
    peak_daypart,
    consistency_score,
    new_artists,
    returning_artists,
    spiking_artists,
  };
}

/**
 * Recomputes narrative-oriented window signals for all dashboard ranges and upserts
 * `analytics_snapshots` (`user_window_signals_v1`). Discovery-style fields derive first plays
 * from `listens` so results stay aligned with the dashboard bundle even if rollups lag.
 */
export async function recomputeUserWindowSignalsSnapshot(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{ userId: string; nowMs: number }>,
): Promise<void> {
  const profile = await getUserProfileFields(db, input.userId);
  const stats_timezone = coalesceStatsRollupTimeZoneIANA(profile?.stats_timezone);
  const earliestIso = await getEarliestListenPlayedAtForUser(db, input.userId);

  const ranges = {
    "7d": await computeSlot(db, {
      userId: input.userId,
      range: "7d",
      nowMs: input.nowMs,
      statsTz: stats_timezone,
      earliestIso,
    }),
    "30d": await computeSlot(db, {
      userId: input.userId,
      range: "30d",
      nowMs: input.nowMs,
      statsTz: stats_timezone,
      earliestIso,
    }),
    "90d": await computeSlot(db, {
      userId: input.userId,
      range: "90d",
      nowMs: input.nowMs,
      statsTz: stats_timezone,
      earliestIso,
    }),
    all: await computeSlot(db, {
      userId: input.userId,
      range: "all",
      nowMs: input.nowMs,
      statsTz: stats_timezone,
      earliestIso,
    }),
  } satisfies Record<DashboardAnalyticsRange, UserWindowSignalsRangeSlot>;

  const body: UserWindowSignalsSnapshotBodyV1 = {
    schema_version: USER_WINDOW_SIGNALS_SCHEMA_VERSION,
    as_of: new Date(input.nowMs).toISOString(),
    stats_timezone,
    ranges,
  };

  await replaceUpsertAnalyticsSnapshot(db, {
    userId: input.userId,
    kind: USER_WINDOW_SIGNALS_SNAPSHOT_KIND,
    bodyJson: JSON.stringify(body),
  });
}

export type ResolveUserWindowSignalsSnapshotResult =
  | { status: "fresh"; snapshot: UserWindowSignalsSnapshotBodyV1 }
  | { status: "missing" }
  | { status: "invalid_body" }
  | { status: "stale"; snapshot_as_of: string };

export async function resolveUserWindowSignalsSnapshotRead(
  db: DashboardAnalyticsDbExecutor,
  userId: string,
): Promise<ResolveUserWindowSignalsSnapshotResult> {
  const { rows } = await db.query<{ body: unknown }>(
    `select body from analytics_snapshots
     where user_id = $1::uuid and kind = $2`,
    [userId, USER_WINDOW_SIGNALS_SNAPSHOT_KIND],
  );
  const row = rows[0];
  if (!row) {
    return { status: "missing" };
  }
  const parsed = parseUserWindowSignalsSnapshotBodyV1(row.body);
  if (!parsed) {
    console.warn(
      `[vs-db:analytics_snapshots] invalid_body user_id=${userId} kind=${USER_WINDOW_SIGNALS_SNAPSHOT_KIND}`,
    );
    return { status: "invalid_body" };
  }
  const { rows: staleRows } = await db.query<{ x: boolean }>(
    `select exists(
       select 1 from listens l
        where l.user_id = $1::uuid
          and l.played_at > $2::timestamptz
        limit 1
     ) as x`,
    [userId, parsed.as_of],
  );
  if (staleRows[0]?.x === true) {
    return { status: "stale", snapshot_as_of: parsed.as_of };
  }
  return { status: "fresh", snapshot: parsed };
}

export async function tryReadFreshUserWindowSignalsSnapshot(
  db: DashboardAnalyticsDbExecutor,
  userId: string,
): Promise<UserWindowSignalsSnapshotBodyV1 | null> {
  const r = await resolveUserWindowSignalsSnapshotRead(db, userId);
  return r.status === "fresh" ? r.snapshot : null;
}
