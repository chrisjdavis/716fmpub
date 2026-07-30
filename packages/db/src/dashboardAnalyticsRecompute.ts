import {
  getDashboardHeroWindowMetrics,
  getDashboardListenSummary,
  getDashboardRecentListens,
  getEarliestListenPlayedAtForUser,
  type DashboardAnalyticsDbExecutor,
  type DashboardAnalyticsRange,
  type DashboardHeroWindowMetrics,
  type DashboardListenSummary,
  type DashboardRecentListen,
} from "./dashboardAnalytics.js";
import { replaceUpsertAnalyticsSnapshot } from "./analyticsSnapshotsUpsert.js";
import {
  queryListenFingerprintAggregateForUser,
  upsertListenFingerprintSnapshot,
} from "./listenFingerprintReadModel.js";
import { recomputeUserWindowSignalsSnapshot } from "./userWindowSignalsRecompute.js";

/** Server-managed dashboard aggregates (queue worker upserts this `kind`). */
export const DASHBOARD_ANALYTICS_BUNDLE_SNAPSHOT_KIND = "dashboard_bundle_v1" as const;

const DASHBOARD_BUNDLE_SCHEMA_VERSION = 1;
const DASHBOARD_BUNDLE_TOP_LIMIT = 15;
const DASHBOARD_BUNDLE_RECENT_LIMIT = 12;

const DASHBOARD_RANGES: readonly DashboardAnalyticsRange[] = [
  "7d",
  "30d",
  "90d",
  "all",
];

export type DashboardAnalyticsBundleRangeSlot = {
  summary: DashboardListenSummary;
  recentListens: DashboardRecentListen[];
  heroWindow: DashboardHeroWindowMetrics;
};

export type DashboardAnalyticsBundleBodyV1 = {
  schema_version: typeof DASHBOARD_BUNDLE_SCHEMA_VERSION;
  as_of: string;
  ranges: Record<DashboardAnalyticsRange, DashboardAnalyticsBundleRangeSlot>;
  archive_totals: {
    allTimeScrobbles: number;
    firstListenAt: string | null;
    topArtistName: string | null;
    topArtistPlays: number | null;
  };
};

export type ResolveDashboardAnalyticsBundleResult =
  | { status: "fresh"; bundle: DashboardAnalyticsBundleBodyV1 }
  | { status: "missing" }
  | { status: "invalid_body" }
  /** Parsed body is still returned so soft consumers (e.g. public `/` teaser) can show near-current metrics. */
  | { status: "stale"; snapshot_as_of: string; bundle: DashboardAnalyticsBundleBodyV1 };

function parseBundleBodyV1(raw: unknown): DashboardAnalyticsBundleBodyV1 | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (o.schema_version !== DASHBOARD_BUNDLE_SCHEMA_VERSION) {
    return null;
  }
  if (typeof o.as_of !== "string" || o.as_of.trim() === "") {
    return null;
  }
  const rangesRaw = o.ranges;
  if (rangesRaw === null || typeof rangesRaw !== "object") {
    return null;
  }
  const rangesObj = rangesRaw as Record<string, unknown>;
  const ranges = {} as Record<DashboardAnalyticsRange, DashboardAnalyticsBundleRangeSlot>;
  for (const key of DASHBOARD_RANGES) {
    const slot = rangesObj[key];
    if (slot === null || typeof slot !== "object") {
      return null;
    }
    const s = slot as Record<string, unknown>;
    if (
      s.summary === null ||
      typeof s.summary !== "object" ||
      s.recentListens === null ||
      !Array.isArray(s.recentListens) ||
      s.heroWindow === null ||
      typeof s.heroWindow !== "object"
    ) {
      return null;
    }
    ranges[key] = {
      summary: s.summary as DashboardListenSummary,
      recentListens: s.recentListens as DashboardRecentListen[],
      heroWindow: s.heroWindow as DashboardHeroWindowMetrics,
    };
  }
  const at = o.archive_totals;
  if (at === null || typeof at !== "object") {
    return null;
  }
  const ar = at as Record<string, unknown>;
  if (
    typeof ar.allTimeScrobbles !== "number" ||
    (ar.firstListenAt !== null && typeof ar.firstListenAt !== "string") ||
    (ar.topArtistName !== null && typeof ar.topArtistName !== "string") ||
    (ar.topArtistPlays !== null && typeof ar.topArtistPlays !== "number")
  ) {
    return null;
  }
  return {
    schema_version: DASHBOARD_BUNDLE_SCHEMA_VERSION,
    as_of: o.as_of,
    ranges,
    archive_totals: {
      allTimeScrobbles: ar.allTimeScrobbles,
      firstListenAt: ar.firstListenAt as string | null,
      topArtistName: ar.topArtistName as string | null,
      topArtistPlays: ar.topArtistPlays as number | null,
    },
  };
}

/**
 * Recomputes dashboard-sized aggregates and upserts `analytics_snapshots` for
 * {@link DASHBOARD_ANALYTICS_BUNDLE_SNAPSHOT_KIND}, then upserts `listen_fingerprint_v1`
 * using one aggregate pass over `listens`. Idempotent: repeated calls with the
 * same `nowMs` and unchanged listens yield the same logical snapshot body.
 *
 * `nowMs` must match the analytics job’s `windowEndIso` anchor; callers must not infer
 * a different clock from `windowStartIso` (see queue job contract for dashboard bundle).
 *
 * **Persistence:** `analytics_snapshots` rows use the same replace-upsert contract as
 * `LAYER1_ANALYTICS_ROW_RECOMPUTE_SEMANTICS` and `buildLayer1AnalyticsSnapshotKind` in
 * `@vs/domain` (this path uses fixed `kind` strings; Layer-1-backed rows use the builder).
 *
 * Layer 1 durable evidence (`artist.user_relationship.v1`) is **not** materialized here;
 * product lifecycle callers enqueue it via {@link enqueueLayer1EvidenceRecomputeForUser}.
 */
export async function recomputeDashboardAnalyticsBundle(
  db: DashboardAnalyticsDbExecutor,
  input: { userId: string; nowMs: number },
): Promise<void> {
  const { userId, nowMs } = input;
  const ranges = {} as Record<DashboardAnalyticsRange, DashboardAnalyticsBundleRangeSlot>;
  for (const range of DASHBOARD_RANGES) {
    const [summary, recentListens, heroWindow] = await Promise.all([
      getDashboardListenSummary(db, {
        userId,
        range,
        topLimit: DASHBOARD_BUNDLE_TOP_LIMIT,
        nowMs,
      }),
      getDashboardRecentListens(db, {
        userId,
        range,
        limit: DASHBOARD_BUNDLE_RECENT_LIMIT,
        nowMs,
      }),
      getDashboardHeroWindowMetrics(db, { userId, range, nowMs }),
    ]);
    ranges[range] = { summary, recentListens, heroWindow };
  }

  const allSummary = ranges.all.summary;
  const earliest_listen_at = await getEarliestListenPlayedAtForUser(db, userId);

  const body: DashboardAnalyticsBundleBodyV1 = {
    schema_version: DASHBOARD_BUNDLE_SCHEMA_VERSION,
    as_of: new Date(nowMs).toISOString(),
    ranges,
    archive_totals: {
      allTimeScrobbles: allSummary.total_scrobbles,
      firstListenAt: earliest_listen_at,
      topArtistName: allSummary.top_artists[0]?.name ?? null,
      topArtistPlays: allSummary.top_artists[0]?.plays ?? null,
    },
  };

  await replaceUpsertAnalyticsSnapshot(db, {
    userId,
    kind: DASHBOARD_ANALYTICS_BUNDLE_SNAPSHOT_KIND,
    bodyJson: JSON.stringify(body),
  });

  await recomputeUserWindowSignalsSnapshot(db, { userId, nowMs });

  const fpAgg = await queryListenFingerprintAggregateForUser(db, userId);
  await upsertListenFingerprintSnapshot(db, {
    userId,
    nowMs,
    max_played_at: fpAgg.max_played_at,
    listen_count: fpAgg.listen_count,
  });
}

/**
 * Resolves `dashboard_bundle_v1`: missing row, invalid JSON shape, stale (listen after
 * `as_of`), or fresh. Malformed bodies log a single operator-facing warning.
 *
 * **Freshness note:** `stale` uses `listens.played_at > as_of` only; if listens are
 * deleted or counts shrink without advancing `max(played_at)`, the row can still read
 * as fresh while totals disagree — callers treat snapshot as best-effort.
 */
export async function resolveDashboardAnalyticsBundleRead(
  db: DashboardAnalyticsDbExecutor,
  userId: string,
): Promise<ResolveDashboardAnalyticsBundleResult> {
  const { rows } = await db.query<{ body: unknown }>(
    `select body from analytics_snapshots
     where user_id = $1::uuid and kind = $2`,
    [userId, DASHBOARD_ANALYTICS_BUNDLE_SNAPSHOT_KIND],
  );
  const row = rows[0];
  if (!row) {
    return { status: "missing" };
  }
  const parsed = parseBundleBodyV1(row.body);
  if (!parsed) {
    console.warn(
      `[vs-db:analytics_snapshots] invalid_body user_id=${userId} kind=${DASHBOARD_ANALYTICS_BUNDLE_SNAPSHOT_KIND}`,
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
    return { status: "stale", snapshot_as_of: parsed.as_of, bundle: parsed };
  }
  return { status: "fresh", bundle: parsed };
}

/**
 * Returns the latest bundle snapshot when present and no canonical listen is newer than
 * `body.as_of` (UTC). Otherwise returns `null` so callers fall back to live queries.
 */
export async function tryReadFreshDashboardAnalyticsBundle(
  db: DashboardAnalyticsDbExecutor,
  userId: string,
): Promise<DashboardAnalyticsBundleBodyV1 | null> {
  const resolved = await resolveDashboardAnalyticsBundleRead(db, userId);
  if (resolved.status === "fresh") {
    return resolved.bundle;
  }
  return null;
}

/**
 * Parsed dashboard bundle body when the snapshot row exists and validates, including when
 * listens have moved past `as_of`. Soft surfaces (public `/` teaser) prefer this over
 * {@link tryReadFreshDashboardAnalyticsBundle} so near-current metrics still render.
 */
export async function tryReadDashboardAnalyticsBundleAllowStale(
  db: DashboardAnalyticsDbExecutor,
  userId: string,
): Promise<DashboardAnalyticsBundleBodyV1 | null> {
  const { rows } = await db.query<{ body: unknown }>(
    `select body from analytics_snapshots
     where user_id = $1::uuid and kind = $2`,
    [userId, DASHBOARD_ANALYTICS_BUNDLE_SNAPSHOT_KIND],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return parseBundleBodyV1(row.body);
}
