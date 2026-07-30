/**
 * PostgreSQL pool helpers for server processes.
 *
 * `getPool` memoizes a single `Pool` per process: the first `DATABASE_URL` wins for
 * the lifetime of the Node process. Callers that need multiple DSNs per process
 * must not reuse this helper as-is.
 */
import { redactForLogLine } from "@vs/sensitive";
import { Pool, type PoolClient } from "pg";
import type { ServerEnv } from "@vs/env";
import { ensurePoolQueryInstrumentation } from "./instrument-pool-query.js";

let pool: Pool | null = null;

export function getPool(env: Pick<ServerEnv, "DATABASE_URL">): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: env.DATABASE_URL });
    ensurePoolQueryInstrumentation(pool);
  }
  return pool;
}

/**
 * Probes the configured pool without throwing for typical `pg` connect/query failures.
 * Errors are returned as `{ ok: false, reason }` so callers can branch without a
 * separate `try/catch` around `connect()`.
 */
export { isPostgresUniqueViolation } from "./postgresErrors.js";

export {
  claimExpiredListenExportArtifacts,
  computeListenExportArtifactAccess,
  countActiveExportJobsForUser,
  createExportJob,
  getExportJobByIdForUser,
  LISTEN_EXPORT_EXPIRED_ERROR_MESSAGE,
  listStaleRunningExportJobs,
  markExportJobCompleted,
  markExportJobFailed,
  markExportJobFailedWhenQueued,
  requeueStaleRunningExportJobs,
  resetExportJobListenProgress,
  setExportJobBullmqJobId,
  tryMarkExportJobRunning,
  updateExportJobListenProgress,
  type ClaimedExpiredListenExportArtifact,
  type ExportJobRecord,
  type ExportJobStage,
  type ListenExportArtifactAccess,
  type ListenExportFormat,
  type MarkExportJobCompletedResult,
  type RequeuedStaleExportJob,
  type StaleRunningExportJobSnapshot,
} from "./exportJobs.js";

export {
  claimNextQueuedImportJob,
  claimNextQueuedImportJobWithPool,
  listQueuedSystemSyncImportJobsForEnqueue,
  countActiveImportJobsForUser,
  countImportJobsForUser,
  createImportJob,
  getImportJobByIdForUser,
  getLatestDashboardImportJobForUser,
  getLatestImportJobForUser,
  listImportJobsForUser,
  listImportJobsForUserWithTotalCount,
  listStaleRunningImportJobs,
  IMPORT_JOBS_USER_SCOPED_NEWEST_FIRST_ORDER_BY,
  markImportJobCompleted,
  markImportJobFailed,
  markImportJobFailedWhenRunning,
  markImportJobRunning,
  requeueRunningImportJobForBullMqRetry,
  requeueStaleRunningImportJobs,
  updateImportJobProgress,
  withImportJobTransaction,
  type ImportJobDbExecutor,
  type ImportJobRecord,
  type ImportJobSource,
  type RequeuedStaleImportJob,
  type StaleRunningImportJobSnapshot,
} from "./importJobs.js";

export {
  getListenFingerprintForUser,
  getListenSyncFromUnixBound,
  getListenSyncSummaryForUser,
  LISTEN_SYNC_SUMMARY_FOR_USER_SQL,
  tryEnqueueListenCatchupJobForUser,
  tryEnqueueListenSyncJob,
  type ListenCatchupEnqueueResult,
  type ListenSyncSchedulerEnqueueResult,
  type ListenFingerprint,
  type ListenFingerprintForApi,
  type ListenSyncSummaryForUser,
} from "./listenSync.js";

export {
  ANALYTICS_SNAPSHOTS_REPLACE_UPSERT_RETURNING_UPDATED_AT_SQL,
  ANALYTICS_SNAPSHOTS_REPLACE_UPSERT_SQL,
  replaceUpsertAnalyticsSnapshot,
  type AnalyticsSnapshotDbExecutor,
} from "./analyticsSnapshotsUpsert.js";

export {
  upsertLayer1EvidenceAnalyticsSnapshot,
  type UpsertLayer1EvidenceAnalyticsSnapshotResult,
} from "./layer1EvidenceAnalyticsSnapshot.js";

export {
  upsertLayer1EvidenceObject,
  type Layer1EvidenceObjectDbExecutor,
  type UpsertLayer1EvidenceObjectResult,
} from "./layer1EvidenceObjectUpsert.js";

export {
  LISTEN_FINGERPRINT_SNAPSHOT_KIND,
  parseListenFingerprintSnapshotBodyV1,
  queryImportIngestFingerprintForUser,
  resolveListenFingerprintSnapshotRead,
  type ImportIngestFingerprint,
  type ListenFingerprintSnapshotBodyV1,
  type ResolveListenFingerprintSnapshotResult,
} from "./listenFingerprintReadModel.js";

export {
  batchInsertRawScrobbles,
  type RawImportListenRow,
  type RawScrobbleBatchInsertResult,
  type RawScrobbleDbExecutor,
} from "./rawScrobbles.js";

export {
  canonicalizePendingRawScrobblesBatch,
  type CanonicalizeDbExecutor,
  type CanonicalizePendingBatchResult,
  type RawScrobbleCanonicalizationStatus,
} from "./canonicalizeRawScrobbles.js";

export {
  archiveListenPageSummaryFromDashboardAllSummary,
  archiveListensLimitFromQueryParam,
  getArchiveListensPage,
  getDashboardHeroWindowMetrics,
  getDashboardListenSummary,
  getDashboardListenSummaryArchivePageHeader,
  getDashboardRecentListens,
  getEarliestListenPlayedAtForUser,
  parseArchiveListenSourceFilter,
  parseArchiveListenTypeFilter,
  parseDashboardAnalyticsRange,
  playedAtLowerBoundUtc,
  recentListensLimitFromQueryParam,
  type ArchiveListenHighlightCover,
  type ArchiveListenPageSummary,
  type ArchiveListenSourceFilter,
  type ArchiveListenTypeFilter,
  type DashboardAnalyticsDbExecutor,
  type DashboardAnalyticsRange,
  type DashboardArchiveListen,
  type DashboardHeroTimelinePoint,
  type DashboardHeroWeekdayPeak,
  type DashboardHeroWindowCalendarInput,
  type DashboardHeroWindowMetrics,
  type DashboardListenSummary,
  type DashboardRecentListen,
  type DashboardTopAlbum,
  type DashboardTopArtist,
  type DashboardTopTrack,
} from "./dashboardAnalytics.js";

export {
  HOME_BRIEFING_SNAPSHOT_KIND,
  parseHomeBriefingSnapshotBodyV1,
  tryReadFreshHomeBriefingSnapshot,
  upsertHomeBriefingSnapshot,
  type HomeBriefingSnapshotBodyV1,
} from "./homeBriefingSnapshot.js";

export {
  queryArtistLastListenPlayedAtBefore,
  queryBriefingReturnAfterGapInsight,
  queryDominantCanonicalArtistInPlayedAtRange,
  recomputeUserListenPeriodMetrics,
  type BriefingReturnAfterGapInsight,
  type DominantCanonicalArtistRow,
  type ListenPeriodMetricsRecomputeMode,
  type ListenPeriodMetricsRecomputeOptions,
} from "./listenPeriodMetricsRecompute.js";

export {
  countUserArtistsFirstPlayInUtcWindow,
  getUserTimeMachineMonthMetrics,
  getUserTimeMachineYearMetrics,
  listUserNewArtistsFirstPlayInUtcWindowRanked,
  listUserTimeMachineMonthDensity,
  listUserTimeMachineMonthTopAlbumsForExploreAnchors,
  listUserTimeMachineMonthTopTracksForExploreAnchors,
  listUserTimeMachineWeeksOverlappingUtcMonth,
  nextUtcCalendarMonthYyyMm,
  parseTimeMachineMonthYyyMm,
  previousUtcCalendarMonthYyyMm,
  sameUtcCalendarMonthOneYearPriorYyyMm,
  utcCalendarMonthBoundsIso,
  utcCalendarYearStartYmdFromMonthYyyMm,
  type TimeMachineExploreAnchorAlbumRow,
  type TimeMachineExploreAnchorTrackRow,
  type TimeMachineMonthDensityRow,
  type TimeMachineMonthMetricsRow,
  type TimeMachineTimelineView,
  type TimeMachineWeekOverlapRow,
  type UserNewArtistInUtcWindowRow,
} from "./timeMachinePeriod.js";

export {
  getUserListenStatsFoundationReadiness,
  type UserListenStatsFoundationReadiness,
} from "./userListenStatsFoundationReadiness.js";

export {
  DASHBOARD_ANALYTICS_BUNDLE_SNAPSHOT_KIND,
  recomputeDashboardAnalyticsBundle,
  resolveDashboardAnalyticsBundleRead,
  tryReadFreshDashboardAnalyticsBundle,
  type DashboardAnalyticsBundleBodyV1,
  type DashboardAnalyticsBundleRangeSlot,
  type ResolveDashboardAnalyticsBundleResult,
} from "./dashboardAnalyticsRecompute.js";

export {
  LAYER1_MAX_WINDOW_PLAYS_PER_ARTIST,
  recomputeArtistUserRelationshipLayer1ForUser30dTop,
  summarizeArtistOutcomes,
  type ArtistUserRelationshipLayer1ArtistOutcome,
  type RecomputeArtistUserRelationshipLayer1ForUser30dTopResult,
} from "./artistUserRelationshipLayer1Recompute.js";

export {
  insertLayer1SignalRunRunning,
  finalizeLayer1SignalRun,
  type FinalizeLayer1SignalRunInput,
  type InsertLayer1SignalRunRunningInput,
  type Layer1SignalRunStatus,
} from "./layer1SignalRun.js";

export {
  listUserIdsForLayer1CursorBatch,
  runLayer1EvidenceRecomputeJob,
  type Layer1EvidenceRecomputeJobResult,
  type Layer1EvidenceRecomputeScope,
  type Layer1EvidenceRecomputeUserRollup,
} from "./layer1EvidenceRecomputeJob.js";

export {
  enqueueLayer1EvidenceRecomputeForUser,
  enqueueLayer1EvidenceRecomputeForUserBestEffort,
  type EnqueueLayer1EvidenceRecomputeForUserBestEffortInput,
  type EnqueueLayer1EvidenceRecomputeForUserInput,
  type EnqueueLayer1EvidenceRecomputeForUserResult,
  type Layer1EvidenceRecomputeEnqueueReason,
} from "./layer1EvidenceRecomputeEnqueue.js";

export type { FailureSummary } from "@vs/queue";

export {
  acknowledgeLayer1UserRecomputeStillFresh,
  finalizeLayer1UserRecomputeFailed,
  finalizeLayer1UserRecomputeFresh,
  finalizeLayer1UserRecomputeNeverComputed,
  getLayer1UserRecomputeStateRow,
  LAYER1_ACTIVE_SIGNAL_VERSION,
  markLayer1UserRecomputeRunning,
  queryLayer1InputWatermarkForUser,
  resetLayer1UserRecomputeRetryBudgetFromExhausted,
  resolveLayer1UserRecomputeEffectiveStatus,
  shouldSkipLayer1UserEvidenceRecompute,
  upsertLayer1UserRecomputeQueuedForUsers,
  type Layer1UserRecomputePersistedStatus,
  type Layer1UserRecomputeStateRow,
} from "./layer1UserRecomputeState.js";

export {
  listAdvancedUserIdsNeedingLayer1Reconciliation,
  tryRunLayer1ReconciliationSweep,
  type Layer1ReconciliationSweepMetrics,
} from "./layer1ScheduledReconciliation.js";

export {
  layer1InputWatermarksEqual,
  mergeLayer1InputWatermarkParts,
  type Layer1InputWatermarkParts,
} from "./layer1InputWatermark.js";

export { isPlausibleRollingSevenDayListenSummary } from "./briefingWindowValidation.js";

export { coalesceStatsRollupTimeZoneIANA } from "./statsRollupTimeZone.js";

export {
  backfillUserListenDailyMetricsFromListens,
  refreshUserListenDailyMetricsForUser,
} from "./userListenDailyMetricsRecompute.js";

export {
  USER_WINDOW_SIGNALS_SNAPSHOT_KIND,
  consistencyScoreFromWeekdayCounts,
  parseUserWindowSignalsSnapshotBodyV1,
  recomputeUserWindowSignalsSnapshot,
  resolveUserWindowSignalsSnapshotRead,
  tryReadFreshUserWindowSignalsSnapshot,
  type ResolveUserWindowSignalsSnapshotResult,
  type UserWindowSignalsArtistPlays,
  type UserWindowSignalsDaypart,
  type UserWindowSignalsRangeSlot,
  type UserWindowSignalsSnapshotBodyV1,
} from "./userWindowSignalsRecompute.js";

export {
  getUserLastfmApiKey,
  getUserProfileFields,
  updateUserProfileFields,
  type UserProfileFields,
  type UserProfileUpdateInput,
} from "./userProfile.js";

export {
  ONBOARDING_MIN_LISTENS_PARTIAL_READY,
  ONBOARDING_STATES,
  countListensForUser,
  deriveImportStatusLabel,
  getUserOnboardingRow,
  isOnboardingInitialImportProcessingComplete,
  markOnboardingCompleted,
  parseOnboardingState,
  resolveOnboardingDashboardGate,
  setOnboardingDeferred,
  syncOnboardingProgressFromImports,
  updateUserOnboardingState,
  type OnboardingGateDecision,
  type OnboardingState,
  type UserOnboardingRow,
} from "./onboardingState.js";

export {
  DELETE_USER_ACCOUNT_CONFIRM_PHRASE,
  deleteUserAccount,
  type DeleteUserAccountResult,
} from "./deleteUserAccount.js";

export {
  PURGE_USER_LISTEN_DATA_CONFIRM_PHRASE,
  purgeUserListenData,
  type PurgeUserListenDataResult,
} from "./purgeUserListenData.js";

export {
  issueStepUpToken,
  STEP_UP_PURPOSE_CHANGE_ACCOUNT_EMAIL,
  STEP_UP_PURPOSE_DELETE_ACCOUNT,
  STEP_UP_PURPOSE_PURGE_LISTEN_DATA,
  STEP_UP_PURPOSES,
  STEP_UP_TOKEN_TTL_MS,
  withConsumedStepUpToken,
  type ConsumeStepUpFailure,
  type StepUpPurpose,
  type StepUpTokenIssue,
} from "./stepUpTokens.js";

export {
  inspectPasswordRecoveryToken,
  issuePasswordRecoveryToken,
  PASSWORD_RECOVERY_TOKEN_TTL_MS,
  withConsumedPasswordRecoveryToken,
  type ConsumePasswordRecoveryFailure,
  type PasswordRecoveryTokenIssue,
} from "./passwordRecoveryTokens.js";

export {
  EMAIL_VERIFICATION_TOKEN_TTL_MS,
  issueEmailVerificationToken,
  withConsumedEmailVerificationToken,
  type ConsumeEmailVerificationFailure,
  type EmailVerificationTokenIssue,
} from "./emailVerificationTokens.js";

export { markUserEmailVerifiedIfUnverified } from "./markUserEmailVerified.js";

export {
  applyVerifiedEmailChange,
  EMAIL_CHANGE_TOKEN_TTL_MS,
  EmailChangeCompletionBlockedError,
  issueEmailChangeToken,
  withConsumedEmailChangeToken,
  type ConsumeEmailChangeFailure,
  type EmailChangeTokenIssue,
} from "./emailChangeTokens.js";

export {
  claimWelcomeEmailDispatchSlot,
  releaseWelcomeEmailDispatchSlot,
} from "./welcomeEmailDispatch.js";

export {
  insertSecurityAuditEvent,
  listSecurityAuditEvents,
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_OUTCOMES,
  tryInsertSecurityAuditEvent,
  type SecurityAuditAction,
  type SecurityAuditEventRow,
  type SecurityAuditMetadata,
  type SecurityAuditOutcome,
} from "./securityAuditEvents.js";

export {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
  insertAdminAuditEvent,
  listAdminAuditEvents,
  listAdminAuditEventsWithActorEmail,
  tryInsertAdminAuditEvent,
  type AdminAuditAction,
  type AdminAuditEventRow,
  type AdminAuditEventWithActorEmailRow,
  type AdminAuditPayload,
  type AdminAuditTargetType,
} from "./adminAuditEvents.js";

export {
  adminUserListDecodedCursorMatchesFingerprint,
  adminUserListRequestFingerprintFromArgs,
  encodeAdminUserListCursor,
  getAdminUserListRecordById,
  listUsersForAdmin,
  tryDecodeAdminUserListCursor,
  type AdminUserListDecodedCursor,
  type AdminUserListRecord,
  type AdminUserListRequestFingerprint,
  type ListUsersForAdminArgs,
  type ListUsersForAdminResult,
} from "./adminUsersList.js";

export {
  applyAdminUserAccountRoleChange,
  applyAdminUserAccountStatusChange,
  applyAdminUserProductPlanChange,
  type AdminUserProductPlanMutationResult,
  type AdminUserRoleMutationResult,
  type AdminUserStatusMutationResult,
} from "./adminUserMutations.js";

export { enqueueLayer1EvidenceRecomputeForAdminCoreToAdvancedUpgradeBestEffort } from "./adminUserProductPlanLayer1Enqueue.js";

export {
  getAdminUserDetailById,
  type AdminUserDetailImportSummary,
  type AdminUserDetailInviteProvenance,
  type AdminUserDetailLayer1ManualRecomputeGate,
  type AdminUserDetailLayer1MaterializedVersionProvenance,
  type AdminUserDetailLayer1Summary,
  type AdminUserDetailListeningProductTier,
  type AdminUserDetailOnboardingSummary,
  type AdminUserDetailRecord,
} from "./adminUserDetail.js";

export {
  getAdminOverviewMetrics,
  type AdminOverviewMetrics,
} from "./adminOverviewMetrics.js";

export {
  betaInviteLifecycleStateFromRecord,
  getBetaInviteById,
  getBetaInviteByIdForCreator,
  getBetaInviteByTokenHash,
  hashBetaInviteTokenForLookup,
  insertBetaInvite,
  listBetaInvitesByLifecycleState,
  listBetaInvitesForAdmin,
  listBetaInvitesForCreator,
  revokeBetaInvite,
  revokeBetaInviteForAdmin,
  insertUserWithBetaInviteRedemption,
  tryRedeemBetaInvite,
  type BetaInviteDbExecutor,
  type BetaInviteIssue,
  type BetaInviteRecord,
  type BetaInviteRedemptionRecord,
  type ListBetaInvitesByLifecycleArgs,
  type ListBetaInvitesForAdminArgs,
  type ListBetaInvitesForCreatorArgs,
  type RedeemBetaInviteFailure,
} from "./betaInvites.js";

export {
  runWithDbPerfContext,
  getDbPerfContext,
  type DbPerfContext,
  type DbPerfSourceKind,
} from "./db-perf-context.js";

export {
  applyBootstrapAccountRole,
  readBootstrapAccountRoleEnv,
  type BootstrapAccountRoleResult,
  type BootstrapPromotionRole,
} from "./bootstrapAccountRole.js";


export {
  countUsers,
  insertSoleOwnerUser,
  type InsertSoleOwnerUserResult,
} from "./singleUserSetup.js";

export async function verifyDatabaseConnectivity(
  env: Pick<ServerEnv, "DATABASE_URL">,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let client: PoolClient | null = null;
  try {
    client = await getPool(env).connect();
    await client.query("select 1 as ok");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: redactForLogLine(message) };
  } finally {
    if (client) {
      client.release();
    }
  }
}
