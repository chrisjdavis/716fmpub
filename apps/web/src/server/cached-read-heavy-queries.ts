import type { Pool } from "pg";
import {
  getArchiveListensPage,
  getDashboardListenSummary,
  getDashboardListenSummaryArchivePageHeader,
  getDashboardRecentListens,
  getEarliestListenPlayedAtForUser,
  type ArchiveListenPageSummary,
  type ArchiveListenSourceFilter,
  type ArchiveListenTypeFilter,
  type DashboardAnalyticsRange,
  type DashboardArchiveListen,
  type DashboardListenSummary,
  type DashboardRecentListen,
} from "@vs/db";
import {
  READ_CACHE_TTL_MS,
  type ReadCacheTelemetryEntry,
  userScopedTtlGetOrSet,
} from "@/server/user-scoped-ttl-read-cache";

export async function readCachedCanonicalDashboardListenSummary(
  pool: Pool,
  userId: string,
  range: DashboardAnalyticsRange,
  options?: {
    topLimit?: number;
    playedAtUtcWindow?: { gteIso: string; ltExclusiveIso: string } | null;
  },
): Promise<{ summary: DashboardListenSummary; read_cache: ReadCacheTelemetryEntry }> {
  const topLimit = options?.topLimit;
  const topKey = topLimit === undefined ? "default" : String(topLimit);
  const playedAtUtcWindow = options?.playedAtUtcWindow ?? null;
  const windowKey =
    playedAtUtcWindow != null
      ? `w:${playedAtUtcWindow.gteIso}\x1e${playedAtUtcWindow.ltExclusiveIso}`
      : null;
  const { value, telemetry } = await userScopedTtlGetOrSet({
    namespace: "analytics_summary_canonical",
    ttlMs: READ_CACHE_TTL_MS.analytics_summary_canonical,
    userId,
    keyParts: windowKey != null ? ["window", windowKey, topKey] : [range, topKey],
    factory: () =>
      getDashboardListenSummary(
        pool,
        windowKey != null
          ? {
              userId,
              range: "all",
              topLimit,
              playedAtUtcWindow,
            }
          : topLimit === undefined
            ? { userId, range }
            : { userId, range, topLimit },
      ),
  });
  return { summary: value, read_cache: telemetry };
}

export async function readCachedDashboardRecentListens(
  pool: Pool,
  input: { userId: string; range: DashboardAnalyticsRange; limit: number },
): Promise<{ listens: DashboardRecentListen[]; read_cache: ReadCacheTelemetryEntry }> {
  const { userId, range, limit } = input;
  const { value, telemetry } = await userScopedTtlGetOrSet({
    namespace: "analytics_recent_listens",
    ttlMs: READ_CACHE_TTL_MS.analytics_recent_listens,
    userId,
    keyParts: [range, String(limit)],
    factory: () =>
      getDashboardRecentListens(pool, {
        userId,
        range,
        limit,
      }),
  });
  return { listens: value, read_cache: telemetry };
}

export async function readCachedArchiveListensPage(
  pool: Pool,
  input: {
    userId: string;
    range: DashboardAnalyticsRange;
    limit: number;
    cursor: { played_at: string; listen_id: string } | null;
    q: string | null | undefined;
    source: ArchiveListenSourceFilter;
    type: ArchiveListenTypeFilter;
    utcArchiveMonthYyyMm?: string | null;
    playedAtUtcWindow?: { gteIso: string; ltExclusiveIso: string } | null;
  },
): Promise<{ listens: DashboardArchiveListen[]; read_cache: ReadCacheTelemetryEntry }> {
  const { userId, range, limit, cursor, q, source, type, utcArchiveMonthYyyMm, playedAtUtcWindow } =
    input;
  const cursorKey =
    cursor === null ? "" : `${cursor.played_at}\x1e${cursor.listen_id}`;
  const monthKey = utcArchiveMonthYyyMm ?? "";
  const { value, telemetry } = await userScopedTtlGetOrSet({
    namespace: "analytics_archive_listens",
    ttlMs: READ_CACHE_TTL_MS.analytics_archive_listens,
    userId,
    keyParts: [range, String(limit), cursorKey, q ?? "", source, type, monthKey],
    factory: () =>
      getArchiveListensPage(pool, {
        userId,
        range,
        limit,
        cursor,
        q,
        source,
        type,
        playedAtUtcWindow: playedAtUtcWindow ?? null,
      }),
  });
  return { listens: value, read_cache: telemetry };
}

export async function readCachedArchiveShellHeaderFallback(
  pool: Pool,
  userId: string,
): Promise<{
  archiveListenSummary: ArchiveListenPageSummary;
  firstListenAt: string | null;
  read_cache: ReadCacheTelemetryEntry;
}> {
  const { value, telemetry } = await userScopedTtlGetOrSet({
    namespace: "archive_shell_header_fallback",
    ttlMs: READ_CACHE_TTL_MS.archive_shell_header_fallback,
    userId,
    keyParts: ["v1"],
    factory: () =>
      Promise.all([
        getDashboardListenSummaryArchivePageHeader(pool, { userId }),
        getEarliestListenPlayedAtForUser(pool, userId),
      ]),
  });
  const [archiveListenSummary, firstListenAt] = value;
  return { archiveListenSummary, firstListenAt, read_cache: telemetry };
}
