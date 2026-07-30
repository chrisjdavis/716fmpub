import { getPool, parseTimeMachineMonthYyyMm } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getServerSession } from "@/server/auth/get-server-session";
import { loadDashboardRouteBootstrap } from "@/server/dashboard-page-data";
import { redirectIfDashboardShellLocked } from "@/server/dashboard-shell-lock";
import { withDashboardRequestContext } from "@/server/dashboard-request-context";
import { userMayReadAiLayer1Outputs } from "@/server/ai-layer1-entitlement";
import { DashboardCompletedPanelsRsc } from "../dashboard-completed-panels-rsc";
import { DashboardPanels } from "../dashboard-panels";
import { DashboardStatsShellFallback } from "../dashboard-stats-shell-fallback";

/** `month` + legacy `range` affect SSR; never serve a cached shell for another selection. */
export const dynamic = "force-dynamic";

function firstSearchParam(v: string | string[] | undefined): string | undefined {
  if (v === undefined) {
    return undefined;
  }
  return Array.isArray(v) ? v[0] : v;
}

export default async function DashboardExplorePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ month?: string | string[]; range?: string | string[]; view?: string | string[] }>;
}>) {
  return withDashboardRequestContext(async () => {
    const session = await getServerSession();
    if (!session) {
      redirect("/login?next=%2Fdashboard%2Fexplore");
    }
    const env = loadServerEnv();
    const pool = getPool(env);
    await redirectIfDashboardShellLocked(pool, session);
    const sp = await searchParams;
    const legacyRange = firstSearchParam(sp.range);
    const monthRaw = firstSearchParam(sp.month);
    const viewRaw = firstSearchParam(sp.view);

    if (viewRaw !== undefined && String(viewRaw).trim() !== "" && String(viewRaw).trim() !== "new-music") {
      const m = parseTimeMachineMonthYyyMm(monthRaw ?? null);
      redirect(m === null ? "/dashboard/explore" : `/dashboard/explore?month=${encodeURIComponent(m)}`);
    }

    if (legacyRange !== undefined && String(legacyRange).trim() !== "") {
      const m = parseTimeMachineMonthYyyMm(monthRaw ?? null);
      redirect(m === null ? "/dashboard/explore" : `/dashboard/explore?month=${encodeURIComponent(m)}`);
    }

    if (monthRaw !== undefined && String(monthRaw).trim() !== "") {
      const m = parseTimeMachineMonthYyyMm(monthRaw);
      if (m === null) {
        redirect("/dashboard/explore");
      }
    }

    const boot = await loadDashboardRouteBootstrap(pool, session.id);

    return (
      <main className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 px-6 pb-16 pt-8 md:pb-24 md:pt-12">
          <div className="mx-auto flex min-w-0 max-w-app-content flex-col gap-12 md:gap-14">
            {boot.kind === "completed_pending" ? (
              <Suspense fallback={<DashboardStatsShellFallback />}>
                <DashboardCompletedPanelsRsc
                  userId={session.id}
                  searchParams={searchParams}
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
