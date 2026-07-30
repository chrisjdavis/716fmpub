import { describe, expect, it } from "vitest";
import type { ImportJobRecord } from "@vs/db";
import { deriveOnboardingImportGuidedSteps } from "./onboarding-import-guided-steps";

function job(partial: Partial<ImportJobRecord> & Pick<ImportJobRecord, "stage">): ImportJobRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-000000000002",
    label: "test",
    lastfm_username: "user",
    source: "user",
    stage: partial.stage,
    error_message: null,
    items_total: null,
    items_processed: 0,
    checkpoint_pages_completed: 0,
    checkpoint_oldest_uts: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("deriveOnboardingImportGuidedSteps", () => {
  it("marks first step active while the user job is running", () => {
    const steps = deriveOnboardingImportGuidedSteps({
      userJob: job({ stage: "running" }),
      importStatsProcessingComplete: false,
    });
    expect(steps[0]?.status).toBe("active");
    expect(steps[1]?.status).toBe("pending");
    expect(steps[2]?.status).toBe("pending");
  });

  it("activates stats step after job completes when stats are not ready", () => {
    const steps = deriveOnboardingImportGuidedSteps({
      userJob: job({ stage: "completed" }),
      importStatsProcessingComplete: false,
    });
    expect(steps[0]?.status).toBe("complete");
    expect(steps[1]?.status).toBe("complete");
    expect(steps[2]?.status).toBe("active");
  });

  it("completes all steps when stats processing is done", () => {
    const steps = deriveOnboardingImportGuidedSteps({
      userJob: job({ stage: "completed" }),
      importStatsProcessingComplete: true,
    });
    expect(steps.every((s) => s.status === "complete")).toBe(true);
  });

  it("marks the download step failed when the user job failed", () => {
    const steps = deriveOnboardingImportGuidedSteps({
      userJob: job({ stage: "failed" }),
      importStatsProcessingComplete: false,
    });
    expect(steps[0]?.status).toBe("failed");
    expect(steps[1]?.status).toBe("pending");
    expect(steps[2]?.status).toBe("pending");
  });
});
