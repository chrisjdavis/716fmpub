import type { Pool } from "pg";
import {
  countListensForUser,
  deriveImportStatusLabel,
  getLatestDashboardImportJobForUser,
  getUserOnboardingRow,
  getUserProfileFields,
  isOnboardingInitialImportProcessingComplete,
  ONBOARDING_MIN_LISTENS_PARTIAL_READY,
  syncOnboardingProgressFromImports,
  type UserOnboardingRow,
} from "@vs/db";
import { sanitizeUserFacingPlainText } from "@vs/domain";
import { loadServerEnv } from "@vs/env";
import { importPipelineStageSentence } from "@/app/dashboard/import-pipeline-stage-label";
import type { AuthenticatedUser } from "@/server/auth/session";
import { deriveOnboardingImportGuidedSteps } from "@/server/onboarding-import-guided-steps";
import { trySendOnboardingImportReadyNotificationBestEffort } from "@/server/onboarding-import-ready-notification";
import type { OnboardingStateApiPayload } from "@/types/onboarding-state";

export async function loadOnboardingStatePayload(input: {
  pool: Pool;
  user: AuthenticatedUser;
}): Promise<OnboardingStateApiPayload> {
  const { pool, user } = input;
  await syncOnboardingProgressFromImports(pool, user.id);
  const row = await getUserOnboardingRow(pool, user.id);
  const profile = await getUserProfileFields(pool, user.id);
  const job = await getLatestDashboardImportJobForUser(pool, user.id);
  const listenCount = await countListensForUser(pool, user.id);
  const hasUsername =
    profile?.lastfm_username !== null &&
    profile?.lastfm_username !== undefined &&
    String(profile.lastfm_username).trim() !== "";
  const hasKey = profile?.has_lastfm_api_key === true;
  const hasUsableArchiveData = listenCount >= ONBOARDING_MIN_LISTENS_PARTIAL_READY;
  const r = row ?? fallbackRow();
  const userJob = job?.source === "user" ? job : null;
  const importItemsProcessed = userJob?.items_processed ?? 0;
  const importItemsTotal = userJob?.items_total ?? null;
  const importPercent =
    importItemsTotal !== null &&
    importItemsTotal !== undefined &&
    Number.isFinite(importItemsTotal) &&
    importItemsTotal > 0
      ? Math.min(
          100,
          Math.round((100 * importItemsProcessed) / importItemsTotal),
        )
      : null;
  const importCheckpointPages = userJob?.checkpoint_pages_completed ?? 0;
  const importPipelineSummary =
    userJob !== null ? importPipelineStageSentence(userJob.stage) : null;
  const importErrorMessage =
    userJob !== null &&
    userJob.stage === "failed" &&
    userJob.error_message &&
    userJob.error_message.trim() !== ""
      ? sanitizeUserFacingPlainText(userJob.error_message)
      : null;
  const importStatsProcessingComplete = await isOnboardingInitialImportProcessingComplete(
    pool,
    user.id,
  );
  const importGuidedSteps = deriveOnboardingImportGuidedSteps({
    userJob,
    importStatsProcessingComplete,
  });
  const env = loadServerEnv();
  void trySendOnboardingImportReadyNotificationBestEffort(pool, env, user.id).catch(() => {
    /* best-effort; worker also attempts after analytics */
  });
  return {
    state: r.onboarding_state,
    canResume: true,
    hasLastfmUsername: hasUsername,
    hasLastfmApiKey: hasKey,
    emailVerified: user.emailVerified,
    importStatsProcessingComplete,
    importGuidedSteps,
    importStatus: deriveImportStatusLabel(job),
    importItemsProcessed,
    importItemsTotal,
    importPercent,
    importCheckpointPages,
    importPipelineSummary,
    importErrorMessage,
    listenCount,
    hasUsableArchiveData,
    onboardingDeferredAt: r.onboarding_deferred_at,
    onboardingCompletedAt: r.onboarding_completed_at,
  };
}

function fallbackRow(): UserOnboardingRow {
  return {
    onboarding_state: "not_started",
    onboarding_dismissed_at: null,
    onboarding_completed_at: null,
    onboarding_context_json: null,
    onboarding_deferred_at: null,
  };
}
