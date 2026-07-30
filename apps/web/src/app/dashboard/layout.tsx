import {
  getPool,
  getUserOnboardingRow,
  getUserProfileFields,
  runWithDbPerfContext,
  syncOnboardingProgressFromImports,
} from "@vs/db";
import { PRODUCT_NAME } from "@vs/domain";
import { loadServerEnv } from "@vs/env";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import homeStyles from "@/app/home-landing.module.css";
import { AppBrandMark } from "@/components/app-brand-mark";
import { ClientPerfTelemetry } from "@/components/client-perf-telemetry";
import { DeferredClientPerfTelemetry } from "@/components/deferred-client-perf-telemetry";
import { getServerSession } from "@/server/auth/get-server-session";
import { isDashboardShellLocked } from "@/server/dashboard-shell-lock";
import { ensureUserStatsFoundationJobsIfNeeded } from "@/server/ensure-user-stats-foundation-jobs";
import { resolveBriefingIANATimeZoneFromProfileAndHeaders } from "@/server/infer-briefing-time-zone";
import { emitRscSegmentPerf } from "@/server/observability/server-perf-log";
import { AppPrimaryNav } from "./app-primary-nav";
import { DashboardDisplayTimeZoneProvider } from "./dashboard-display-timezone-context";
import { DashboardListenFingerprintPoller } from "./dashboard-listen-fingerprint-poller";
import { DashboardRouteLockClient } from "./dashboard-route-lock-client";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const traceHeader = requestHeaders.get("x-vs-trace")?.trim();
  const traceId =
    traceHeader && traceHeader.length > 0 ? traceHeader : crypto.randomUUID();

  return runWithDbPerfContext(
    { source: "rsc:/dashboard/**", sourceKind: "rsc", traceId },
    async () => {
        const t0 = performance.now();
        const session = await getServerSession();
        if (!session) {
          redirect("/login?next=%2Fdashboard");
        }

        const env = loadServerEnv();
        const pool = getPool(env);
        await syncOnboardingProgressFromImports(pool, session.id);
        const onboardingRow = await getUserOnboardingRow(pool, session.id);
        const shellLocked = isDashboardShellLocked(session, onboardingRow);
        const [, profile] = await Promise.all([
          ensureUserStatsFoundationJobsIfNeeded(pool, env, session.id),
          getUserProfileFields(pool, session.id),
        ]);
        const displayTimeZone = resolveBriefingIANATimeZoneFromProfileAndHeaders(
          profile?.stats_timezone,
          requestHeaders,
        );
        const page = children;
        emitRscSegmentPerf({
          segment: "dashboard_tree",
          traceId,
          totalMs: Math.round((performance.now() - t0) * 1000) / 1000,
        });

        return (
          <div className="flex min-h-screen flex-col">
            {process.env.NEXT_PUBLIC_VS_CLIENT_PERF === "1" ? (
              <ClientPerfTelemetry />
            ) : (
              <DeferredClientPerfTelemetry />
            )}
            {session.emailVerified ? <DashboardListenFingerprintPoller /> : null}
            <header className="border-b border-hairline px-6 py-6 md:py-8">
              <div className="mx-auto flex min-w-0 max-w-app-content items-center justify-between gap-4">
                <Link
                  href={shellLocked ? "/dashboard" : "/"}
                  className={`${homeStyles.brandLine} shrink-0 text-inherit no-underline hover:no-underline hover:opacity-90`}
                >
                  <AppBrandMark />
                  <span className={homeStyles.brandName}>{PRODUCT_NAME}</span>
                </Link>
                <AppPrimaryNav locked={shellLocked} />
              </div>
            </header>
            <DashboardDisplayTimeZoneProvider value={displayTimeZone}>
              <DashboardRouteLockClient locked={shellLocked}>{page}</DashboardRouteLockClient>
            </DashboardDisplayTimeZoneProvider>
          </div>
        );
    },
  );
}
