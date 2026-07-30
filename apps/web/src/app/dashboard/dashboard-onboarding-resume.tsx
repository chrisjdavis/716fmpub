import type { OnboardingState } from "@vs/db";
import Link from "next/link";
import { ONBOARDING_RESUME_CTA, onboardingResumeSecondaryLine } from "./onboarding-resume-copy";

const ctaClassName =
  "inline-flex min-h-11 shrink-0 items-center justify-center border border-wire px-4 py-2 font-mono text-label uppercase tracking-[0.08em] text-foreground no-underline hover:bg-canvas";

type Props = Readonly<{
  onboardingState: OnboardingState;
}>;

export function DashboardOnboardingResumeBanner({ onboardingState }: Props) {
  const secondary = onboardingResumeSecondaryLine(onboardingState);
  return (
    <div className="bg-raised px-6 py-4" role="region" aria-label="Guided setup incomplete">
      <div className="mx-auto flex max-w-app-content flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-sans text-body text-foreground">
          Guided setup is not finished. {secondary}
        </p>
        <Link href="/dashboard" className={ctaClassName}>
          {ONBOARDING_RESUME_CTA}
        </Link>
      </div>
    </div>
  );
}
