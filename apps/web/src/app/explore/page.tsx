import {
  getPool,
  getSoleOwnerPublicListeningAccess,
  parseTimeMachineMonthYyyMm,
} from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DashboardCompletedPanelsRsc } from "@/app/dashboard/dashboard-completed-panels-rsc";
import { DashboardStatsShellFallback } from "@/app/dashboard/dashboard-stats-shell-fallback";
import {
  PublicListeningNotReady,
  PublicListeningShell,
  PublicListeningUnavailable,
} from "@/components/public-listening-shell";
import { DashboardDisplayTimeZoneProvider } from "@/app/dashboard/dashboard-display-timezone-context";
import { loadDashboardRouteBootstrap } from "@/server/dashboard-page-data";
import { isInstanceConfigured } from "@/server/instance-configured";
import {
  PUBLIC_ARCHIVE_PATH,
  PUBLIC_EXPLORE_PATH,
} from "@/server/listening-surface-routes";
import { userMayReadAiLayer1Outputs } from "@/server/ai-layer1-entitlement";
import type { ProductPlan } from "@vs/domain";

export const dynamic = "force-dynamic";

function firstSearchParam(v: string | string[] | undefined): string | undefined {
  if (v === undefined) {
    return undefined;
  }
  return Array.isArray(v) ? v[0] : v;
}

function asProductPlan(raw: string): ProductPlan {
  if (raw === "advanced" || raw === "core") {
    return raw;
  }
  return "advanced";
}

export default async function PublicExplorePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ month?: string | string[]; range?: string | string[]; view?: string | string[] }>;
}>) {
  if (!(await isInstanceConfigured())) {
    redirect("/setup");
  }

  const env = loadServerEnv();
  const pool = getPool(env);
  const access = await getSoleOwnerPublicListeningAccess(pool);
  if (!access) {
    return (
      <PublicListeningShell active="explore">
        <PublicListeningUnavailable />
      </PublicListeningShell>
    );
  }

  const sp = await searchParams;
  const legacyRange = firstSearchParam(sp.range);
  const monthRaw = firstSearchParam(sp.month);
  const viewRaw = firstSearchParam(sp.view);

  if (viewRaw !== undefined && String(viewRaw).trim() !== "" && String(viewRaw).trim() !== "new-music") {
    const m = parseTimeMachineMonthYyyMm(monthRaw ?? null);
    redirect(m === null ? PUBLIC_EXPLORE_PATH : `${PUBLIC_EXPLORE_PATH}?month=${encodeURIComponent(m)}`);
  }

  if (legacyRange !== undefined && String(legacyRange).trim() !== "") {
    const m = parseTimeMachineMonthYyyMm(monthRaw ?? null);
    redirect(m === null ? PUBLIC_EXPLORE_PATH : `${PUBLIC_EXPLORE_PATH}?month=${encodeURIComponent(m)}`);
  }

  if (monthRaw !== undefined && String(monthRaw).trim() !== "") {
    const m = parseTimeMachineMonthYyyMm(monthRaw);
    if (m === null) {
      redirect(PUBLIC_EXPLORE_PATH);
    }
  }

  const boot = await loadDashboardRouteBootstrap(pool, access.userId);
  const displayTimeZone = access.stats_timezone?.trim() || "UTC";
  const allowAi = userMayReadAiLayer1Outputs(asProductPlan(access.product_plan));

  return (
    <PublicListeningShell active="explore">
      <DashboardDisplayTimeZoneProvider value={displayTimeZone}>
        <main className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 px-6 pb-16 pt-8 md:pb-24 md:pt-12">
            <div className="mx-auto flex min-w-0 max-w-app-content flex-col gap-12 md:gap-14">
              {boot.kind === "completed_pending" ? (
                <Suspense fallback={<DashboardStatsShellFallback />}>
                  <DashboardCompletedPanelsRsc
                    userId={access.userId}
                    searchParams={searchParams}
                    job={boot.job}
                    allowAiLayer1Reads={allowAi}
                    explorePath={PUBLIC_EXPLORE_PATH}
                    archivePath={PUBLIC_ARCHIVE_PATH}
                    skipStatsFoundationJobs
                    viewer="public"
                  />
                </Suspense>
              ) : (
                <PublicListeningNotReady />
              )}
            </div>
          </div>
        </main>
      </DashboardDisplayTimeZoneProvider>
    </PublicListeningShell>
  );
}
