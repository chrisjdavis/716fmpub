import type { DashboardAnalyticsDbExecutor } from "./dashboardAnalytics.js";
import { replaceUpsertAnalyticsSnapshot } from "./analyticsSnapshotsUpsert.js";

export const HOME_BRIEFING_SNAPSHOT_KIND = "home_briefing_v1" as const;

export const HOME_BRIEFING_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type HomeBriefingSnapshotBodyV1 = Readonly<{
  schema_version: typeof HOME_BRIEFING_SNAPSHOT_SCHEMA_VERSION;
  /** ISO timestamp anchor; stale when a canonical listen is strictly newer. */
  as_of: string;
  time_zone: string;
  /** Local civil date `YYYY-MM-DD` in {@link time_zone} for cache keying. */
  calendar_ymd: string;
  briefing: unknown;
}>;

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object";
}

export function parseHomeBriefingSnapshotBodyV1(raw: unknown): HomeBriefingSnapshotBodyV1 | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.schema_version !== HOME_BRIEFING_SNAPSHOT_SCHEMA_VERSION) {
    return null;
  }
  if (typeof raw.as_of !== "string" || raw.as_of.trim() === "") {
    return null;
  }
  if (typeof raw.time_zone !== "string" || raw.time_zone.trim() === "") {
    return null;
  }
  if (typeof raw.calendar_ymd !== "string" || raw.calendar_ymd.trim() === "") {
    return null;
  }
  if (!("briefing" in raw)) {
    return null;
  }
  return {
    schema_version: HOME_BRIEFING_SNAPSHOT_SCHEMA_VERSION,
    as_of: raw.as_of,
    time_zone: raw.time_zone,
    calendar_ymd: raw.calendar_ymd,
    briefing: raw.briefing,
  };
}

/**
 * Returns the cached home briefing when the row is valid JSON, matches the requested local
 * calendar key, and no canonical listen is newer than `body.as_of`.
 */
export async function tryReadFreshHomeBriefingSnapshot(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{
    userId: string;
    timeZone: string;
    calendarYmd: string;
  }>,
): Promise<HomeBriefingSnapshotBodyV1 | null> {
  const { rows } = await db.query<{ body: unknown; has_newer_listen_than_as_of: boolean }>(
    `select s.body,
            exists(
              select 1
                from listens l
               where l.user_id = $1::uuid
                 and l.played_at > coalesce(
                   (nullif(trim(s.body->>'as_of'), ''))::timestamptz,
                   to_timestamp(0)
                 )
               limit 1
            ) as has_newer_listen_than_as_of
       from analytics_snapshots s
      where s.user_id = $1::uuid
        and s.kind = $2`,
    [input.userId, HOME_BRIEFING_SNAPSHOT_KIND],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  const parsed = parseHomeBriefingSnapshotBodyV1(row.body);
  if (!parsed) {
    console.warn(
      `[vs-db:analytics_snapshots] invalid_body user_id=${input.userId} kind=${HOME_BRIEFING_SNAPSHOT_KIND}`,
    );
    return null;
  }
  if (parsed.time_zone !== input.timeZone || parsed.calendar_ymd !== input.calendarYmd) {
    return null;
  }
  if (row.has_newer_listen_than_as_of === true) {
    return null;
  }
  return parsed;
}

export async function upsertHomeBriefingSnapshot(
  db: DashboardAnalyticsDbExecutor,
  input: Readonly<{ userId: string; body: HomeBriefingSnapshotBodyV1 }>,
): Promise<void> {
  await replaceUpsertAnalyticsSnapshot(db, {
    userId: input.userId,
    kind: HOME_BRIEFING_SNAPSHOT_KIND,
    bodyJson: JSON.stringify(input.body),
  });
}
