import { getPool } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { headers } from "next/headers";
import type { ImportJobApiRow } from "@/server/api/import-job-row";
import { ensureUserStatsFoundationJobsIfNeeded } from "@/server/ensure-user-stats-foundation-jobs";
import { loadDashboardHomeBriefingForCompletedHome } from "@/server/load-dashboard-home-briefing";
import { DashboardConversationalHome } from "./dashboard-conversational-home";

export async function DashboardCompletedHomeRsc({
  userId,
  displayName,
  job,
  allowAiLayer1Reads,
}: Readonly<{
  userId: string;
  displayName: string | null;
  job: ImportJobApiRow;
  allowAiLayer1Reads: boolean;
}>) {
  const env = loadServerEnv();
  const pool = getPool(env);
  const headerList = await headers();
  const [{ statsFoundationPending }, briefing] = await Promise.all([
    ensureUserStatsFoundationJobsIfNeeded(pool, env, userId),
    loadDashboardHomeBriefingForCompletedHome(pool, {
      userId,
      displayName,
      job,
      headers: headerList,
      allowAiLayer1Reads,
    }),
  ]);

  return (
    <DashboardConversationalHome
      briefing={briefing}
      statsFoundationPending={statsFoundationPending}
      allowAiLayer1Reads={allowAiLayer1Reads}
    />
  );
}
