import { getPool } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { OnboardingClient } from "@/app/onboarding/onboarding-client";
import { getServerSession } from "@/server/auth/get-server-session";
import { evaluateDashboardShellLock } from "@/server/dashboard-shell-lock";
import { loadDashboardRouteBootstrap } from "@/server/dashboard-page-data";
import { withDashboardRequestContext } from "@/server/dashboard-request-context";
import { userMayReadAiLayer1Outputs } from "@/server/ai-layer1-entitlement";
import { DashboardCompletedHomeRsc } from "./dashboard-completed-home-rsc";
import { DashboardEmailVerificationBanner } from "./dashboard-email-verification-banner";
import { DashboardHomeShellFallback } from "./dashboard-home-shell-fallback";
import { DashboardPanels } from "./dashboard-panels";

/** Logged-in home is uncached; old `?range=` links forward to the explore stats surface. */
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ range?: string | string[] }>;
}>) {
  return withDashboardRequestContext(async () => {
    const session = await getServerSession();
    if (!session) {
      redirect("/login?next=%2Fdashboard");
    }
    const env = loadServerEnv();
    const pool = getPool(env);
    const { locked } = await evaluateDashboardShellLock(pool, session);

    const sp = await searchParams;
    const rawRange = sp.range;
    if (rawRange !== undefined && String(Array.isArray(rawRange) ? rawRange[0] : rawRange).length > 0) {
      redirect(locked ? "/dashboard" : "/dashboard/explore");
    }

    if (locked) {
      return (
        <main className="flex min-h-0 flex-1 flex-col">
          {!session.emailVerified ? (
            <div className="border-b border-hairline">
              <DashboardEmailVerificationBanner email={session.email} />
            </div>
          ) : null}
          <OnboardingClient allowDefer={false} embeddedInDashboard />
        </main>
      );
    }

    const boot = await loadDashboardRouteBootstrap(pool, session.id);

    const completed = boot.kind === "completed_pending";

    return (
      <main className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 px-6 pb-16 pt-8 md:pb-24 md:pt-12">
          <div className="mx-auto flex min-w-0 max-w-app-content flex-col gap-12 md:gap-14">
            {completed ? (
              <Suspense fallback={<DashboardHomeShellFallback />}>
                <DashboardCompletedHomeRsc
                  userId={session.id}
                  displayName={boot.profile.display_name}
                  job={boot.job}
                  allowAiLayer1Reads={userMayReadAiLayer1Outputs(session.productPlan)}
                />
              </Suspense>
            ) : (
              <DashboardPanels
                body={boot.model.body}
                profileLastfmUsername={boot.model.profile.lastfm_username}
              />
            )}
          </div>
        </div>
      </main>
    );
  });
}
