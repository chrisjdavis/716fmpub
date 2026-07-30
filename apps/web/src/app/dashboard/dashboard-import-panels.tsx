import type { ListenSyncSummaryForUser } from "@vs/db";
import Link from "next/link";
import type { ImportJobApiRow } from "@/server/api/import-job-row";
import type { ImportsPageBody, ImportsPageJobHistoryPaging } from "@/server/imports-page-data";
import { DashboardImportLive } from "./dashboard-import-live";
import { DashboardImportPipelineExtras } from "./dashboard-import-pipeline-extras";
import { DashboardQueueImport } from "./dashboard-queue-import";
import { DashboardRetryImport } from "./dashboard-retry-import";
import { DashboardInstantTimestamp } from "./dashboard-instant-timestamp";

const panelSectionTitleMarginBottom = "mb-[calc(0.75rem*1.2*2)]";

const panelSectionTitleClass = `mx-0 mt-0 ${panelSectionTitleMarginBottom} font-mono text-heading font-semibold uppercase leading-tight tracking-[0.06em] text-foreground`;

/**
 * Import job status and snapshot UI for `/dashboard/imports` and for non-completed states on
 * the main dashboard. Pass `jobHistory` + `listenSync` on `/dashboard/imports` only.
 */
export function DashboardImportJobPanels({
  body,
  profileLastfmUsername,
  jobHistory,
  jobHistoryPaging,
  listenSync,
}: Readonly<{
  body: ImportsPageBody;
  profileLastfmUsername: string | null;
  jobHistory?: readonly ImportJobApiRow[];
  jobHistoryPaging?: ImportsPageJobHistoryPaging;
  listenSync?: Readonly<{
    minIntervalSeconds: number;
    summary: ListenSyncSummaryForUser | null;
  }>;
}>) {
  const extras =
    listenSync !== undefined && jobHistoryPaging !== undefined ? (
      <DashboardImportPipelineExtras
        jobHistory={jobHistory ?? []}
        jobHistoryPaging={jobHistoryPaging}
        listenSync={listenSync}
      />
    ) : null;

  if (body.kind === "empty") {
    const isIdle = body.reason === "idle";
    return (
      <>
        <section className="max-w-xl space-y-6 overflow-hidden rounded-md border border-hairline bg-surface p-6 md:p-8">
          <p className="font-sans text-body text-foreground">
            {isIdle
              ? "The newest import job on file is idle. Open Settings when you are ready to queue another import."
              : "This account has no import jobs yet. Add your Last.fm username in Settings, then queue an import from this page."}
          </p>
          {profileLastfmUsername ? (
            <p className="font-mono text-caption uppercase tracking-[0.04em] text-muted">
              Last.fm username on file: {profileLastfmUsername}
            </p>
          ) : (
            <p className="font-mono text-caption uppercase tracking-[0.04em] text-warning">
              [LAST.FM USERNAME NOT SET — ADD IN SETTINGS]
            </p>
          )}
          <div className="flex flex-col gap-6 border-t border-hairline pt-6">
            <Link
              href="/dashboard/settings"
              className="inline-flex w-fit border border-wire px-8 py-3 font-mono text-label uppercase tracking-[0.1em] text-foreground no-underline hover:no-underline hover:bg-raised"
            >
              Open settings
            </Link>
            {profileLastfmUsername ? (
              <DashboardQueueImport lastfmUsername={profileLastfmUsername} />
            ) : null}
          </div>
        </section>
        {extras}
      </>
    );
  }

  if (body.kind === "in_progress") {
    return (
      <>
        <section className="space-y-8 overflow-hidden rounded-md border border-hairline bg-surface p-6 md:p-8">
          <p className="font-sans text-body text-foreground">
            Last.fm user{" "}
            <span className="font-mono text-body text-display">{body.job.lastfm_username}</span>
            . Values below are read from the database on each refresh and poll.
          </p>
          <DashboardImportLive initialJob={body.job} />
        </section>
        {extras}
      </>
    );
  }

  if (body.kind === "failed") {
    return (
      <>
        <section className="space-y-8 overflow-hidden rounded-md border border-hairline bg-surface p-6 md:p-8">
          <div className="space-y-2">
            <p className="font-mono text-label uppercase tracking-[0.08em] text-overline">Job label</p>
            <p className="font-sans text-body text-foreground">{body.job.label}</p>
          </div>
          <div className="space-y-2">
            <p className="font-mono text-label uppercase tracking-[0.08em] text-overline">
              Last.fm username
            </p>
            <p className="font-mono text-body text-foreground">{body.job.lastfm_username}</p>
          </div>
          <div className="space-y-2 border-t border-hairline pt-6">
            <p className="font-mono text-label uppercase tracking-[0.08em] text-overline">Error</p>
            <p className="font-mono text-caption uppercase tracking-[0.04em] text-error">
              {body.job.error_message?.trim()
                ? body.job.error_message
                : "[ERROR MESSAGE NOT PERSISTED]"}
            </p>
          </div>
          <div className="space-y-3 border-t border-hairline pt-6">
            <p className="font-mono text-caption uppercase tracking-[0.04em] text-muted">
              Queue a new job with the same Last.fm username. This does not mutate the failed row.
            </p>
            <DashboardRetryImport job={body.job} />
          </div>
        </section>
        {extras}
      </>
    );
  }

  const { job } = body;
  return (
    <>
      <section className="flex flex-col gap-0 overflow-hidden rounded-md border border-hairline bg-surface p-6 md:p-8">
        <p className={panelSectionTitleClass}>Import snapshot</p>
        <div className="mb-3 grid gap-6 sm:grid-cols-2 sm:gap-x-10">
          <div className="min-w-0 space-y-1.5">
            <p className="font-mono text-caption uppercase tracking-[0.04em] text-overline">Job label</p>
            <p className="font-mono text-body leading-snug text-foreground break-words">
              {job.label}
            </p>
          </div>
          <div className="min-w-0 space-y-1.5">
            <p className="font-mono text-caption uppercase tracking-[0.04em] text-overline">
              Last.fm user
            </p>
            <p className="font-mono text-body leading-snug text-foreground break-words">
              {job.lastfm_username}
            </p>
          </div>
        </div>
        <p className="border-t border-hairline pt-4 font-mono text-caption uppercase tracking-[0.04em] text-muted">
          Job updated{" "}
          <time className="tabular-nums normal-case" dateTime={job.updated_at}>
            <DashboardInstantTimestamp iso={job.updated_at} variant="precise" />
          </time>
        </p>
      </section>
      {extras}
    </>
  );
}
