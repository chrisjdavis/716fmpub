import type { OnboardingState } from "@vs/db";

export type OnboardingImportGuidedStepId =
  | "lastfm_download"
  | "persist_listens"
  | "stats_rollups";

export type OnboardingImportGuidedStep = Readonly<{
  id: OnboardingImportGuidedStepId;
  title: string;
  detail: string;
  status: "pending" | "active" | "complete" | "failed";
}>;

export type OnboardingStateApiPayload = Readonly<{
  state: OnboardingState;
  canResume: boolean;
  hasLastfmUsername: boolean;
  hasLastfmApiKey: boolean;
  emailVerified: boolean;
  /** True when the user import job finished and rollup stats tables are ready (or there are zero listens). */
  importStatsProcessingComplete: boolean;
  /** Ordered checklist for the guided import + stats pipeline (persisted server-side; safe across sessions). */
  importGuidedSteps: readonly OnboardingImportGuidedStep[];
  importStatus: "none" | "queued" | "running" | "completed" | "failed" | "idle";
  /** Latest user import job batch progress (0 when no user job). */
  importItemsProcessed: number;
  /** Total batches for the job when known; otherwise null. */
  importItemsTotal: number | null;
  /** 0–100 when `importItemsTotal` is a positive finite number; otherwise null. */
  importPercent: number | null;
  /** Last.fm pages fully persisted for the latest user import job. */
  importCheckpointPages: number;
  /** Plain-language import pipeline line for the latest user job, or null. */
  importPipelineSummary: string | null;
  /** Latest user import job error text when `importStatus` is `failed` (sanitized). */
  importErrorMessage: string | null;
  listenCount: number;
  hasUsableArchiveData: boolean;
  onboardingDeferredAt: string | null;
  onboardingCompletedAt: string | null;
}>;
