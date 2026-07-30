import type { ImportJobRecord } from "@vs/db";
import type { OnboardingImportGuidedStep } from "@/types/onboarding-state";

export function deriveOnboardingImportGuidedSteps(input: Readonly<{
  userJob: ImportJobRecord | null;
  importStatsProcessingComplete: boolean;
}>): OnboardingImportGuidedStep[] {
  const j = input.userJob;
  const stage = j?.stage;
  const jobFailed = j !== null && stage === "failed";
  const jobCompleted = j !== null && stage === "completed";
  const jobRun = j !== null && (stage === "queued" || stage === "running");

  const s1: OnboardingImportGuidedStep["status"] = jobFailed
    ? "failed"
    : jobCompleted
      ? "complete"
      : jobRun
        ? "active"
        : "pending";
  const s2: OnboardingImportGuidedStep["status"] = jobCompleted ? "complete" : "pending";
  const s3: OnboardingImportGuidedStep["status"] = input.importStatsProcessingComplete
    ? "complete"
    : jobCompleted && !input.importStatsProcessingComplete
      ? "active"
      : "pending";

  return [
    {
      id: "lastfm_download",
      title: "Download from Last.fm",
      detail: "Streams your scrobbles and persists raw import batches.",
      status: s1,
    },
    {
      id: "persist_listens",
      title: "Normalize and store listens",
      detail: "Builds canonical listens plus artist and album records from your history.",
      status: s2,
    },
    {
      id: "stats_rollups",
      title: "Compute dashboard stats",
      detail: "Fills period, artist, and daily metrics used across charts and summaries.",
      status: s3,
    },
  ];
}
