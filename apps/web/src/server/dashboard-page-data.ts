import type { Pool } from "pg";
import {
  getDashboardHeroWindowMetrics,
  getLatestDashboardImportJobForUser,
  getUserProfileFields,
  parseDashboardAnalyticsRange,
  type DashboardAnalyticsRange,
  type DashboardHeroWindowMetrics,
  type DashboardListenSummary,
  type DashboardRecentListen,
  type ImportJobRecord,
} from "@vs/db";
import { sanitizeUserFacingPlainText } from "@vs/domain";
import {
  importJobApiRowFromRecord,
  type ImportJobApiRow,
} from "@/server/api/import-job-row";
import {
  readCachedCanonicalDashboardListenSummary,
  readCachedDashboardRecentListens,
} from "@/server/cached-read-heavy-queries";
import { sanitizeDashboardListenSummaryForPublicApi } from "@/server/sanitize-dashboard-listen-summary";
import { sanitizeDashboardRecentListenForPublicApi } from "@/server/sanitize-listen-for-public-api";
import { readFreshDashboardAnalyticsBundleForRequest } from "@/server/dashboard-analytics-bundle-request-cache";

/** Dashboard: top lists (artists / tracks / albums); must cover max albums slice (15). */
const DASHBOARD_LISTEN_SUMMARY_TOP_LIMIT = 15;

export type DashboardEmptyReason = "no_jobs" | "idle";

export type DashboardPageBody =
  | { kind: "empty"; reason: DashboardEmptyReason }
  | { kind: "in_progress"; job: ImportJobApiRow }
  | { kind: "failed"; job: ImportJobApiRow }
  | {
      kind: "completed";
      job: ImportJobApiRow;
      summary: DashboardListenSummary;
      /** Loaded in a separate Suspense/async RSC chunk so the stats shell can stream first. */
      heroWindow: DashboardHeroWindowMetrics;
    };

export type DashboardProfileModel = Readonly<{
  lastfm_username: string | null;
  display_name: string | null;
}>;

export type DashboardPageModel = {
  profile: DashboardProfileModel;
  body: DashboardPageBody;
};

/** Import states rendered directly from `loadDashboardRouteBootstrap` (never `completed` here). */
export type DashboardBootstrapNonCompletedBody = Exclude<DashboardPageBody, { kind: "completed" }>;

export type DashboardBootstrapNonCompletedModel = {
  profile: DashboardProfileModel;
  body: DashboardBootstrapNonCompletedBody;
};

/**
 * First paint for the dashboard route: profile + import state only. When the latest job is
 * completed, aggregates (`summary`, `heroWindow`) load in a deferred RSC chunk.
 */
export type DashboardRouteBootstrap =
  | { kind: "non_completed"; model: DashboardBootstrapNonCompletedModel }
  | {
      kind: "completed_pending";
      profile: DashboardProfileModel;
      job: ImportJobApiRow;
    };

/** Maps the latest import job row to a coarse dashboard bucket (tests + loader). */
export type DashboardImportBucket =
  | { kind: "empty"; reason: DashboardEmptyReason }
  | { kind: "in_progress"; record: ImportJobRecord }
  | { kind: "failed"; record: ImportJobRecord }
  | { kind: "completed"; record: ImportJobRecord };

export function classifyDashboardImportBucket(
  latest: ImportJobRecord | null,
): DashboardImportBucket {
  if (!latest) {
    return { kind: "empty", reason: "no_jobs" };
  }
  if (latest.stage === "idle") {
    return { kind: "empty", reason: "idle" };
  }
  if (latest.stage === "queued" || latest.stage === "running") {
    return { kind: "in_progress", record: latest };
  }
  if (latest.stage === "failed") {
    return { kind: "failed", record: latest };
  }
  return { kind: "completed", record: latest };
}

const COMPLETED_RECENT_LIMIT = 12;

/**
 * Recent listens for the dashboard “Full archive view” column (same source as the former inline
 * SSR field on the completed `DashboardPageBody` variant).
 */
export async function loadDashboardRecentListens(
  pool: Pool,
  userId: string,
  analyticsRange: DashboardAnalyticsRange,
  options?: Readonly<{ allowAiLayer1Reads?: boolean }>,
): Promise<DashboardRecentListen[]> {
  const allowAiLayer1Reads = options?.allowAiLayer1Reads ?? false;
  const bundle = allowAiLayer1Reads
    ? await readFreshDashboardAnalyticsBundleForRequest(pool, userId)
    : null;
  if (bundle) {
    return bundle.ranges[analyticsRange].recentListens.map(
      sanitizeDashboardRecentListenForPublicApi,
    );
  }
  const { listens } = await readCachedDashboardRecentListens(pool, {
    userId,
    range: analyticsRange,
    limit: COMPLETED_RECENT_LIMIT,
  });
  return listens.map(sanitizeDashboardRecentListenForPublicApi);
}

/**
 * Reads Next.js `searchParams.range` into a {@link DashboardAnalyticsRange}.
 * Returns `null` when the query is present but not a supported token (caller should redirect).
 */
export function parseDashboardRangeSearchParam(
  raw: string | string[] | undefined,
): DashboardAnalyticsRange | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseDashboardAnalyticsRange(s);
}

export async function loadDashboardRouteBootstrap(
  pool: Pool,
  userId: string,
): Promise<DashboardRouteBootstrap> {
  const [profile, latest] = await Promise.all([
    getUserProfileFields(pool, userId),
    getLatestDashboardImportJobForUser(pool, userId),
  ]);
  const profileModel: DashboardProfileModel = {
    lastfm_username:
      profile?.lastfm_username == null
        ? null
        : sanitizeUserFacingPlainText(profile.lastfm_username),
    display_name:
      profile?.display_name == null || profile.display_name.trim() === ""
        ? null
        : sanitizeUserFacingPlainText(profile.display_name),
  };
  const bucket = classifyDashboardImportBucket(latest);

  if (bucket.kind === "empty") {
    return {
      kind: "non_completed",
      model: { profile: profileModel, body: { kind: "empty", reason: bucket.reason } },
    };
  }
  if (bucket.kind === "in_progress") {
    return {
      kind: "non_completed",
      model: {
        profile: profileModel,
        body: {
          kind: "in_progress",
          job: importJobApiRowFromRecord(bucket.record),
        },
      },
    };
  }
  if (bucket.kind === "failed") {
    return {
      kind: "non_completed",
      model: {
        profile: profileModel,
        body: {
          kind: "failed",
          job: importJobApiRowFromRecord(bucket.record),
        },
      },
    };
  }

  return {
    kind: "completed_pending",
    profile: profileModel,
    job: importJobApiRowFromRecord(bucket.record),
  };
}

/** Heavy dashboard aggregates for a completed import (bundle or canonical SQL fallback). */
export async function loadDashboardCompletedStats(
  pool: Pool,
  userId: string,
  analyticsRange: DashboardAnalyticsRange,
  job: ImportJobApiRow,
  options?: Readonly<{ allowAiLayer1Reads?: boolean }>,
): Promise<Extract<DashboardPageBody, { kind: "completed" }>> {
  const allowAiLayer1Reads = options?.allowAiLayer1Reads ?? false;
  const bundle = allowAiLayer1Reads
    ? await readFreshDashboardAnalyticsBundleForRequest(pool, userId)
    : null;
  if (bundle) {
    const slot = bundle.ranges[analyticsRange];
    return {
      kind: "completed",
      job,
      summary: sanitizeDashboardListenSummaryForPublicApi(slot.summary),
      heroWindow: slot.heroWindow,
    };
  }

  if (analyticsRange === "all") {
    const [allSummaryPack, heroWindow] = await Promise.all([
      readCachedCanonicalDashboardListenSummary(pool, userId, "all", {
        topLimit: DASHBOARD_LISTEN_SUMMARY_TOP_LIMIT,
      }),
      getDashboardHeroWindowMetrics(pool, { userId, range: "all" }),
    ]);
    const allSummary = allSummaryPack.summary;
    return {
      kind: "completed",
      job,
      summary: sanitizeDashboardListenSummaryForPublicApi(allSummary),
      heroWindow,
    };
  }

  const [summaryPack, heroWindow] = await Promise.all([
    readCachedCanonicalDashboardListenSummary(pool, userId, analyticsRange, {
      topLimit: DASHBOARD_LISTEN_SUMMARY_TOP_LIMIT,
    }),
    getDashboardHeroWindowMetrics(pool, { userId, range: analyticsRange }),
  ]);
  const summary = summaryPack.summary;

  return {
    kind: "completed",
    job,
    summary: sanitizeDashboardListenSummaryForPublicApi(summary),
    heroWindow,
  };
}

export async function loadDashboardPageData(
  pool: Pool,
  userId: string,
  analyticsRange: DashboardAnalyticsRange,
  options?: Readonly<{ allowAiLayer1Reads?: boolean }>,
): Promise<DashboardPageModel> {
  const boot = await loadDashboardRouteBootstrap(pool, userId);
  if (boot.kind === "non_completed") {
    return boot.model;
  }
  return {
    profile: boot.profile,
    body: await loadDashboardCompletedStats(pool, userId, analyticsRange, boot.job, {
      allowAiLayer1Reads: options?.allowAiLayer1Reads ?? false,
    }),
  };
}
