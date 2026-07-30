import { getPool, parseTimeMachineMonthYyyMm } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { redirect } from "next/navigation";
import type { ImportJobApiRow } from "@/server/api/import-job-row";
import { ensureUserStatsFoundationJobsIfNeeded } from "@/server/ensure-user-stats-foundation-jobs";
import { loadTimeMachineExploreModel } from "@/server/load-time-machine-explore";
import { DashboardExploreAdvancedGate } from "./dashboard-explore-advanced-gate";
import { DashboardTimeMachineExplore } from "./dashboard-time-machine-explore";

function firstSearchParam(
  v: string | string[] | undefined,
): string | undefined {
  if (v === undefined) {
    return undefined;
  }
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Completed-home explore route: Musical Time Machine (UTC calendar months).
 */
export async function DashboardCompletedPanelsRsc({
  userId,
  searchParams,
  job,
  allowAiLayer1Reads,
  explorePath = "/dashboard/explore",
  archivePath = "/dashboard/archive",
  skipStatsFoundationJobs = false,
}: Readonly<{
  userId: string;
  searchParams: Promise<{ month?: string | string[]; range?: string | string[]; view?: string | string[] }>;
  job: ImportJobApiRow;
  allowAiLayer1Reads: boolean;
  explorePath?: string;
  archivePath?: string;
  /** When true, do not enqueue stats foundation jobs (public guest reads). */
  skipStatsFoundationJobs?: boolean;
}>) {
  const env = loadServerEnv();
  const pool = getPool(env);
  const sp = await searchParams;
  const monthParam = firstSearchParam(sp.month);
  const viewRaw = firstSearchParam(sp.view);

  if (viewRaw !== undefined && String(viewRaw).trim() !== "" && String(viewRaw).trim() !== "new-music") {
    const m = parseTimeMachineMonthYyyMm(monthParam ?? null);
    redirect(m === null ? explorePath : `${explorePath}?month=${encodeURIComponent(m)}`);
  }

  const { statsFoundationPending } = skipStatsFoundationJobs
    ? { statsFoundationPending: false }
    : await ensureUserStatsFoundationJobsIfNeeded(pool, env, userId);
  if (!allowAiLayer1Reads) {
    return <DashboardExploreAdvancedGate statsFoundationPending={statsFoundationPending} />;
  }

  const model = await loadTimeMachineExploreModel(pool, {
    userId,
    monthParam,
    viewParam: viewRaw,
    job,
    allowAiLayer1Reads,
    archivePath,
  });

  if (!model) {
    return (
      <div className="rounded-md border border-hairline bg-surface px-6 py-8">
        <p className="font-sans text-body text-muted">Stats are not available for this import state.</p>
      </div>
    );
  }

  const viewTrim = String(viewRaw ?? "").trim();
  if (viewTrim === "new-music" && model.timelineView !== "new-music") {
    redirect(`${explorePath}?month=${encodeURIComponent(model.monthYyyMm)}`);
  }
  if (model.timelineView === "new-music") {
    const monthOk = parseTimeMachineMonthYyyMm(monthParam ?? null) === model.monthYyyMm;
    if (viewTrim !== "new-music" || !monthOk) {
      redirect(
        `${explorePath}?month=${encodeURIComponent(model.monthYyyMm)}&view=${encodeURIComponent("new-music")}`,
      );
    }
  }

  return (
    <DashboardTimeMachineExplore
      model={model}
      statsFoundationPending={statsFoundationPending}
      explorePath={explorePath}
      archivePath={archivePath}
    />
  );
}
