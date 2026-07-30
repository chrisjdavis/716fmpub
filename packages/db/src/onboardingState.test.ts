import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STATES,
  parseOnboardingState,
  resolveOnboardingDashboardGate,
} from "./onboardingState.js";

describe("onboardingState", () => {
  it("parses known states", () => {
    for (const s of ONBOARDING_STATES) {
      expect(parseOnboardingState(s)).toBe(s);
    }
    expect(parseOnboardingState("bogus")).toBeNull();
    expect(parseOnboardingState(null)).toBeNull();
  });

  it("resolveOnboardingDashboardGate requires onboarding by default", () => {
    const row = {
      onboarding_state: "intro" as const,
      onboarding_dismissed_at: null,
      onboarding_completed_at: null,
      onboarding_context_json: null,
      onboarding_deferred_at: null,
    };
    expect(resolveOnboardingDashboardGate(row).kind).toBe("require_onboarding");
  });

  it("resolveOnboardingDashboardGate allows deferred users in app", () => {
    const row = {
      onboarding_state: "configure_lastfm" as const,
      onboarding_dismissed_at: null,
      onboarding_completed_at: null,
      onboarding_context_json: null,
      onboarding_deferred_at: "2026-01-01T00:00:00.000Z",
    };
    expect(resolveOnboardingDashboardGate(row).kind).toBe("allow_app");
  });

  it("resolveOnboardingDashboardGate allows completed", () => {
    const row = {
      onboarding_state: "completed" as const,
      onboarding_dismissed_at: null,
      onboarding_completed_at: "2026-01-02T00:00:00.000Z",
      onboarding_context_json: null,
      onboarding_deferred_at: null,
    };
    expect(resolveOnboardingDashboardGate(row).kind).toBe("allow_app");
  });

  it("resolveOnboardingDashboardGate treats null row as require onboarding", () => {
    const d = resolveOnboardingDashboardGate(null);
    expect(d.kind).toBe("require_onboarding");
    expect(d.row.onboarding_state).toBe("not_started");
  });
});
