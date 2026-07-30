import type { OnboardingState } from "@vs/db";

/** Shared CTA; keep in sync with any tests or API copy. */
export const ONBOARDING_RESUME_CTA = "Continue setup" as const;

/**
 * One sentence after “Guided setup is not finished.” — where the user left off.
 * Shown only while onboarding is incomplete (never for `completed`).
 */
export function onboardingResumeSecondaryLine(state: OnboardingState): string {
  switch (state) {
    case "not_started":
    case "intro":
      return "Connect Last.fm and run your archive import to populate your ledger.";
    case "connect_source":
    case "configure_lastfm":
    case "validating_lastfm":
      return "Finish Last.fm connection and validation next.";
    case "ready_to_import":
    case "import_started":
    case "import_in_progress":
      return "Finish your archive import so listens sync into this account.";
    case "partial_ready":
      return "Review import status and complete the remaining guided steps.";
    case "completed":
      return "";
    default: {
      const _u: never = state;
      return _u;
    }
  }
}
