import { getPool } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { redirect } from "next/navigation";
import { getServerSession } from "@/server/auth/get-server-session";
import { redirectIfDashboardShellLocked } from "@/server/dashboard-shell-lock";
import { loadImportsPageData } from "@/server/imports-page-data";
import { DashboardImportJobPanels } from "../dashboard-import-panels";

function parseImportHistoryPageParam(raw: string | string[] | undefined): {
  requestedPage: number;
  invalid: boolean;
} {
  const pageParam = Array.isArray(raw) ? raw[0] : raw;
  if (pageParam === undefined || pageParam === "") {
    return { requestedPage: 1, invalid: false };
  }
  const parsed = Number.parseInt(String(pageParam), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return { requestedPage: 1, invalid: true };
  }
  return { requestedPage: parsed, invalid: false };
}

function importsHeadline(body: Awaited<ReturnType<typeof loadImportsPageData>>["body"]): string {
  switch (body.kind) {
    case "empty":
      return "No active import";
    case "in_progress":
      return "In progress";
    case "failed":
      return "Failed";
    case "completed":
      return "Latest import";
  }
}

export default async function DashboardImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const session = await getServerSession();
  if (!session) {
    redirect("/login?next=%2Fdashboard%2Fimports");
  }
  const env = loadServerEnv();
  const pool = getPool(env);
  await redirectIfDashboardShellLocked(pool, session);
  const sp = await searchParams;
  const { requestedPage, invalid } = parseImportHistoryPageParam(sp.page);
  if (invalid) {
    redirect("/dashboard/imports");
  }
  const model = await loadImportsPageData(pool, session.id, {
    listenSyncMinIntervalSeconds: env.LISTEN_SYNC_USER_MIN_INTERVAL_SEC,
    importHistoryPage: requestedPage,
  });
  if (requestedPage !== model.jobHistoryPaging.page && sp.page !== undefined) {
    redirect(
      model.jobHistoryPaging.page === 1
        ? "/dashboard/imports"
        : `/dashboard/imports?page=${model.jobHistoryPaging.page}`,
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="px-6 pb-20 pt-10 md:pb-28 md:pt-14">
        <div className="mx-auto flex max-w-app-content flex-col gap-16">
          <div className="space-y-10 text-left">
            <header className="space-y-6">
              <p className="font-mono text-label uppercase tracking-[0.1em] text-overline">Import</p>
              <h1 className="font-display text-display-xl text-display">Import archive</h1>
              <p className="font-mono text-caption uppercase tracking-[0.14em] text-muted">
                Connect → import → review → unlock
              </p>
              <p className="font-mono text-caption uppercase tracking-[0.08em] text-muted">
                Status: {importsHeadline(model.body)}
              </p>
            </header>
            <DashboardImportJobPanels
              body={model.body}
              profileLastfmUsername={model.profile.lastfm_username}
              jobHistory={model.jobHistory}
              jobHistoryPaging={model.jobHistoryPaging}
              listenSync={model.listenSync}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
