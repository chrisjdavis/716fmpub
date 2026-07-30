/**
 * Shared domain types and constants for the Last.fm–compatible analytics MVP.
 * Import pipeline stages are explicit; do not infer lifecycle from side effects.
 */
export const WORKER_TICK_INTERVAL_MS = 5_000 as const;

/** Subtracted from newest stored `played_at` when computing Last.fm `from` for incremental sync. */
export const LISTEN_SYNC_OVERLAP_SEC = 120 as const;

/** Cap on Last.fm pages per background sync job (200 rows/page at worker default). */
export const LISTEN_SYNC_MAX_PAGES_PER_RUN = 3 as const;

export { LISTEN_FINGERPRINT_POLL_MS } from "./listenFingerprintPoll.js";

/** Default minimum seconds between enqueueing a background sync for the same user. */
export const LISTEN_SYNC_USER_MIN_INTERVAL_SEC_DEFAULT = 120 as const;

export {
  LAYER1_RECONCILE_FAILED_RETRY_COOLDOWN_SEC_DEFAULT,
  LAYER1_RECONCILE_TICK_MIN_INTERVAL_SEC_DEFAULT,
  LAYER1_RECONCILE_USERS_PER_TICK_DEFAULT,
  LAYER1_RECOMPUTE_MAX_CONSECUTIVE_FAILURES_DEFAULT,
} from "./layer1ReconcileSchedule.js";

export {
  EXPORT_ARTIFACT_RETENTION_SEC_DEFAULT,
  exportZipDisplayFilename,
  resolveExportArtifactAbsolutePath,
} from "./exportArtifactPaths.js";

export const PRODUCT_NAME = "716fmpub" as const;

export { AUTH_SESSION_COOKIE_NAME } from "./authSessionCookieName.js";
export { AUTH_CSRF_COOKIE_NAME } from "./authCsrfCookieName.js";
export { API_CSRF_HEADER_NAME } from "./authCsrfHeaderName.js";

export type {
  CoverArtThumbnailSize,
  ImportPipelineStage,
  SourceEventHashInput,
} from "./import/index.js";
export {
  assertTransitionImportJobStage,
  canTransitionImportJobStage,
  computeSourceEventHash,
  coverArtArchiveFrontThumbnailUrl,
  IMPORT_PIPELINE_STAGES,
  isTerminalImportJobStage,
  lastfmPreferredCoverImageUrlFromWirePayload,
  normalizeImportMbid,
  normalizeImportString,
  parseImportPipelineStage,
} from "./import/index.js";

export { sanitizeUserFacingPlainText } from "./userFacingPlainText.js";

export {
  accountEmailIdentityKey,
  canonicalizeAccountEmail,
} from "./accountEmail.js";

export {
  ACCOUNT_ROLES,
  accountRoleAtLeast,
  isAccountRole,
  type AccountRole,
} from "./accountRole.js";
export {
  ACCOUNT_STATUSES,
  isAccountStatus,
  type AccountStatus,
} from "./accountStatus.js";

export {
  PRODUCT_PLANS,
  isProductPlan,
  parseProductPlan,
  productPlanAtLeast,
  type ProductPlan,
} from "./productPlan.js";

export {
  ADVANCED_ENTITLEMENT_REQUIRED_CODE,
  ADVANCED_ENTITLEMENT_REQUIRED_MESSAGE,
  hasAdvancedEntitlement,
  requireAdvancedEntitlement,
  type AdvancedEntitlementDeniedCode,
  type ProductEntitlementContext,
  type RequireAdvancedEntitlementResult,
} from "./productEntitlement.js";

export type { BetaInviteLifecycleState } from "./betaInviteLifecycle.js";
export { resolveBetaInviteLifecycleState } from "./betaInviteLifecycle.js";

export {
  computeListenHistoryCoverageQuality,
  countUtcCalendarDaysIntersectingWindow,
  DEFAULT_LISTEN_HISTORY_COVERAGE_THRESHOLDS,
  listenHistoryWindowDurationMs,
  LISTENING_HISTORY_COVERAGE_METRIC_FAMILY_V1,
} from "./listeningHistoryCoverageQuality.js";
export {
  coalesceStatsRollupTimeZoneIANA,
} from "./statsRollupTimeZone.js";
export {
  computeListeningTemporalSignals,
  gregorianOrdinalDayNumber,
  LISTENING_TEMPORAL_SIGNAL_METRIC_FAMILY_V1,
  postgresDowSunday0FromGregorianYmd,
} from "./listeningTemporalSignals.js";
export type {
  ListenHistoryCoverageQualityOptions,
  ListenHistoryCoverageQualityResult,
  ListenHistoryRollupCoverageObservation,
  ListenHistoryWindowBounds,
  ListenHistoryWindowGrain,
  ListenHistoryWindowMetrics,
} from "./listeningHistoryCoverageQuality.js";
export {
  computeListeningWindowComparisons,
  LISTENING_WINDOW_COMPARISON_METRIC_FAMILY_V1,
} from "./listeningWindowComparison.js";
export type {
  ListeningWindowComparisonAnomalyCandidates,
  ListeningWindowComparisonInput,
  ListeningWindowComparisonResult,
  ListeningWindowCountSlice,
  NoveltyFamiliarityBalanceBlock,
  WindowPeerComparisonBlock,
  WindowPeerComparisonNotComputedReason,
} from "./listeningWindowComparison.js";
export type {
  ListeningTemporalBurstWindow,
  ListeningTemporalSignalsInput,
  ListeningTemporalSignalsResult,
  ListeningTemporalStreakWindow,
} from "./listeningTemporalSignals.js";

export {
  ARTIST_USER_RELATIONSHIP_DORMANT_GAP_MS,
  ARTIST_USER_RELATIONSHIP_METRIC_FAMILY_V1,
  ARTIST_USER_RELATIONSHIP_SIGNAL_DEFINITION_VERSION,
  ARTIST_USER_RELATIONSHIP_SIGNAL_KIND,
  DEFAULT_ARTIST_RELATIONSHIP_THRESHOLDS,
  buildArtistUserRelationshipLayer1Evidence,
  computeArtistUserRelationshipSignals,
  deterministicArtistUserRelationshipSignalInstanceId,
  deterministicUuidFromSeed,
  isCanonicalArtistMbidString,
} from "./artistUserRelationshipSignals.js";
export type {
  ArtistEntityRef,
  ArtistUserRelationshipPlayRow,
  ArtistUserRelationshipSignalsInput,
  ArtistUserRelationshipSignalsResult,
} from "./artistUserRelationshipSignals.js";

export {
  assertLayer1EvidenceObject,
  buildLayer1AnalyticsSnapshotKind,
  jsonValueSchema,
  LAYER1_ANALYTICS_ROW_RECOMPUTE_SEMANTICS,
  LAYER1_ANALYTICS_SNAPSHOT_KIND_SCHEME_VERSION,
  LAYER1_EVIDENCE_SCHEMA_VERSION,
  LAYER1_INSUFFICIENCY_CODES,
  LAYER1_JSON_PAYLOAD_FORMAT_V1,
  LAYER1_ACTIVE_SIGNAL_VERSION,
  formatLayer1SignalVersionFromEvidenceColumns,
  layer1EvidenceObjectSchema,
  layer1EvidenceScopeStableJson,
  parseLayer1EvidenceObject,
  extractLayer1EvidencePersistenceMetadata,
  type BuildLayer1AnalyticsSnapshotKindResult,
  type JsonValue,
  type Layer1AnalyticsSnapshotKindError,
  type Layer1ComparabilityFlags,
  type Layer1EvidencePersistenceMetadata,
  type Layer1DeterministicScores,
  type Layer1EvidenceObject,
  type Layer1EvidenceScope,
  type Layer1Insufficiency,
  type Layer1InsufficiencyCode,
  type Layer1JsonPayload,
} from "./evidence/index.js";
