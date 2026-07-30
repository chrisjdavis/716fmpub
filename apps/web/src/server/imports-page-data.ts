import type { Pool } from "pg";
import type { ListenSyncSummaryForUser } from "@vs/db";
import {
  getLatestDashboardImportJobForUser,
  getListenSyncSummaryForUser,
  getUserProfileFields,
  listImportJobsForUser,
  listImportJobsForUserWithTotalCount,
} from "@vs/db";
import {
  classifyDashboardImportBucket,
  type DashboardEmptyReason,
} from "@/server/dashboard-page-data";
import {
  importJobApiRowFromRecord,
  type ImportJobApiRow,
} from "@/server/api/import-job-row";

export type ImportsPageBody =
  | { kind: "empty"; reason: DashboardEmptyReason }
  | { kind: "in_progress"; job: ImportJobApiRow }
  | { kind: "failed"; job: ImportJobApiRow }
  | { kind: "completed"; job: ImportJobApiRow };

const IMPORT_HISTORY_PAGE_SIZE = 10 as const;

export type ImportsPageJobHistoryPaging = {
  page: number;
  pageSize: number;
  totalCount: number;
};

export type ImportsPageModel = {
  profile: { lastfm_username: string | null };
  body: ImportsPageBody;
  /** Manual + background jobs, newest first (for `/dashboard/imports`). */
  jobHistory: ImportJobApiRow[];
  jobHistoryPaging: ImportsPageJobHistoryPaging;
  listenSync: Readonly<{
    /** Same knob as worker `LISTEN_SYNC_USER_MIN_INTERVAL_SEC` (seconds). */
    minIntervalSeconds: number;
    summary: ListenSyncSummaryForUser | null;
  }>;
};

/**
 * Imports page: latest **user** import bucket plus full job history and listen-sync summary.
 */
export async function loadImportsPageData(
  pool: Pool,
  userId: string,
  input: {
    listenSyncMinIntervalSeconds: number;
    /** 1-based page index for the import run history table. */
    importHistoryPage?: number;
  },
): Promise<ImportsPageModel> {
  const rawPage = input.importHistoryPage;
  const requestedPage =
    typeof rawPage === "number" && Number.isFinite(rawPage) && rawPage >= 1
      ? Math.floor(rawPage)
      : 1;

  const provisionalOffset = (requestedPage - 1) * IMPORT_HISTORY_PAGE_SIZE;

  const [profile, latest, listenSummary, firstPage] = await Promise.all([
    getUserProfileFields(pool, userId),
    getLatestDashboardImportJobForUser(pool, userId),
    getListenSyncSummaryForUser(pool, userId),
    listImportJobsForUserWithTotalCount(pool, {
      userId,
      limit: IMPORT_HISTORY_PAGE_SIZE,
      offset: provisionalOffset,
    }),
  ]);

  const totalCount = firstPage.totalCount;
  const totalPages = Math.max(1, Math.ceil(totalCount / IMPORT_HISTORY_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const correctOffset = (page - 1) * IMPORT_HISTORY_PAGE_SIZE;

  let records = firstPage.records;
  if (correctOffset !== provisionalOffset) {
    records = await listImportJobsForUser(pool, {
      userId,
      limit: IMPORT_HISTORY_PAGE_SIZE,
      offset: correctOffset,
    });
  }
  const profileModel = { lastfm_username: profile?.lastfm_username ?? null };
  const jobHistory = records.map((r) => importJobApiRowFromRecord(r));
  const jobHistoryPaging: ImportsPageJobHistoryPaging = {
    page,
    pageSize: IMPORT_HISTORY_PAGE_SIZE,
    totalCount,
  };
  const listenSync = {
    minIntervalSeconds: input.listenSyncMinIntervalSeconds,
    summary: listenSummary,
  };
  const bucket = classifyDashboardImportBucket(latest);

  if (bucket.kind === "empty") {
    return {
      profile: profileModel,
      body: { kind: "empty", reason: bucket.reason },
      jobHistory,
      jobHistoryPaging,
      listenSync,
    };
  }
  if (bucket.kind === "in_progress") {
    return {
      profile: profileModel,
      body: { kind: "in_progress", job: importJobApiRowFromRecord(bucket.record) },
      jobHistory,
      jobHistoryPaging,
      listenSync,
    };
  }
  if (bucket.kind === "failed") {
    return {
      profile: profileModel,
      body: { kind: "failed", job: importJobApiRowFromRecord(bucket.record) },
      jobHistory,
      jobHistoryPaging,
      listenSync,
    };
  }

  return {
    profile: profileModel,
    body: { kind: "completed", job: importJobApiRowFromRecord(bucket.record) },
    jobHistory,
    jobHistoryPaging,
    listenSync,
  };
}
