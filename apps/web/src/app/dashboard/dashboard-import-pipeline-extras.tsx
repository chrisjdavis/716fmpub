"use client";

import type { ListenSyncSummaryForUser } from "@vs/db";
import Link from "next/link";
import type { KeyboardEvent } from "react";
import { useCallback, useMemo, useReducer, useState } from "react";
import type { ImportJobApiRow } from "@/server/api/import-job-row";
import type { ImportsPageJobHistoryPaging } from "@/server/imports-page-data";
import { importPipelineStageShortLabel } from "./import-pipeline-stage-label";
import { formatCount } from "./format-count";
import { DashboardInstantTimestamp } from "./dashboard-instant-timestamp";

const panelSectionTitleMarginBottom = "mb-[calc(0.75rem*1.2*2)]";
const panelSectionTitleClass = `mx-0 mt-0 ${panelSectionTitleMarginBottom} font-mono text-heading font-semibold uppercase leading-tight tracking-[0.06em] text-foreground`;

function sourceKind(job: ImportJobApiRow): string {
  return job.source === "system_sync" ? "Background" : "Manual";
}

function ImportsListenSyncRunnerCard({
  listenSync,
  showDevRunnerHints,
}: Readonly<{
  listenSync: Readonly<{
    minIntervalSeconds: number;
    summary: ListenSyncSummaryForUser | null;
  }>;
  showDevRunnerHints: boolean;
}>) {
  const s = listenSync.summary;
  const pending = s?.pendingBackgroundJobs ?? 0;
  const lastAttempt = s?.lastListenSyncAttemptAt ?? null;
  const lastBg = s?.lastBackgroundJobUpdatedAt ?? null;

  return (
    <section className="space-y-5 overflow-hidden rounded-md border border-hairline bg-surface p-6 md:p-8">
      <p className={panelSectionTitleClass}>Background listen sync</p>
      <p className="font-sans text-body leading-relaxed text-foreground">
        After your first successful manual import, 716FM can enqueue small{" "}
        <span className="font-mono text-body text-display">Listen sync</span> jobs to pull newer
        scrobbles from Last.fm. The numbers below come from your account in the database; they do
        not prove a worker process is running in this deployment.
      </p>
      {showDevRunnerHints ? (
        <details className="rounded border border-hairline bg-raised/40 p-4 font-mono text-caption uppercase tracking-[0.06em] text-muted">
          <summary className="cursor-pointer font-mono text-label text-foreground hover:underline">
            Running the app locally?
          </summary>
          <p className="mt-4 font-sans text-body normal-case tracking-normal text-foreground">
            Start the worker from the repo root with{" "}
            <span className="font-mono text-caption text-display">npm run dev:worker</span> and set{" "}
            <span className="font-mono text-caption text-display">LASTFM_API_KEY</span>. This
            dashboard cannot detect whether that process is up.
          </p>
        </details>
      ) : null}
      <dl className="grid gap-4 border-t border-hairline pt-5 font-mono text-caption uppercase tracking-[0.06em] text-muted sm:grid-cols-2">
        <div className="space-y-1">
          <dt>Minimum gap between sync checks</dt>
          <dd className="font-mono text-body tabular-nums normal-case tracking-normal text-foreground">
            {formatCount(listenSync.minIntervalSeconds)}s
          </dd>
        </div>
        <div className="space-y-1">
          <dt>Sync jobs waiting</dt>
          <dd className="font-mono text-body tabular-nums normal-case tracking-normal text-foreground">
            {formatCount(pending)}
          </dd>
        </div>
        <div className="space-y-1">
          <dt>Last sync check</dt>
          <dd className="font-mono text-body normal-case tracking-normal text-foreground">
            {lastAttempt ? (
              <time dateTime={lastAttempt}>
                <DashboardInstantTimestamp iso={lastAttempt} variant="precise" />
              </time>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div className="space-y-1">
          <dt>Last sync job activity</dt>
          <dd className="font-mono text-body normal-case tracking-normal text-foreground">
            {lastBg ? (
              <time dateTime={lastBg}>
                <DashboardInstantTimestamp iso={lastBg} variant="precise" />
              </time>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function ImportsJobHistoryPager({
  paging,
}: Readonly<{
  paging: ImportsPageJobHistoryPaging;
}>) {
  const { page, pageSize, totalCount } = paging;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  if (totalPages <= 1) {
    return null;
  }
  const prevHref = page <= 2 ? "/dashboard/imports" : `/dashboard/imports?page=${page - 1}`;
  const nextHref = `/dashboard/imports?page=${page + 1}`;
  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-4 font-mono text-caption uppercase tracking-[0.06em] text-muted"
      aria-label="Import run history pages"
    >
      <p className="tabular-nums">
        Page {page} of {totalPages} · {totalCount} rows
      </p>
      <div className="flex flex-wrap gap-6">
        {page > 1 ? (
          <Link
            href={prevHref}
            className="text-foreground underline underline-offset-4 hover:no-underline"
          >
            Previous
          </Link>
        ) : (
          <span className="text-muted/50">Previous</span>
        )}
        {page < totalPages ? (
          <Link
            href={nextHref}
            className="text-foreground underline underline-offset-4 hover:no-underline"
          >
            Next
          </Link>
        ) : (
          <span className="text-muted/50">Next</span>
        )}
      </div>
    </nav>
  );
}

type SortKey =
  | "kind"
  | "label"
  | "lastfm"
  | "stage"
  | "rows"
  | "pages"
  | "total"
  | "updated_at";

function defaultSortDir(key: SortKey): "asc" | "desc" {
  if (key === "updated_at" || key === "rows" || key === "pages" || key === "total") {
    return "desc";
  }
  return "asc";
}

function compareJobs(
  a: ImportJobApiRow,
  b: ImportJobApiRow,
  key: SortKey,
  dir: "asc" | "desc",
): number {
  const flip = dir === "asc" ? 1 : -1;
  switch (key) {
    case "kind":
      return flip * sourceKind(a).localeCompare(sourceKind(b));
    case "label":
      return flip * a.label.localeCompare(b.label);
    case "lastfm":
      return flip * a.lastfm_username.localeCompare(b.lastfm_username);
    case "stage":
      return flip * a.stage.localeCompare(b.stage);
    case "rows":
      return flip * (a.items_processed - b.items_processed);
    case "pages":
      return flip * (a.checkpoint_pages_completed - b.checkpoint_pages_completed);
    case "total": {
      const av = a.items_total ?? -1;
      const bv = b.items_total ?? -1;
      return flip * (av - bv);
    }
    case "updated_at":
      return flip * a.updated_at.localeCompare(b.updated_at);
    default:
      return 0;
  }
}

function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = "left",
}: Readonly<{
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}>) {
  const active = activeKey === sortKey;
  const arrow = active ? (dir === "asc" ? " ↑" : " ↓") : "";
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={`py-2 pr-3 font-mono text-caption uppercase tracking-[0.06em] text-muted ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        type="button"
        className={`flex max-w-full items-baseline gap-1 font-mono text-caption uppercase tracking-[0.06em] text-muted underline-offset-4 hover:text-foreground hover:underline ${
          align === "right" ? "ml-auto w-full min-w-0 justify-end" : ""
        }`}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <span className="font-sans tabular-nums normal-case tracking-normal text-muted" aria-hidden>
          {arrow}
        </span>
      </button>
    </th>
  );
}

type SortState = Readonly<{ key: SortKey; dir: "asc" | "desc" }>;

function sortReducer(state: SortState, action: Readonly<{ type: "sort"; key: SortKey }>): SortState {
  if (state.key === action.key) {
    return { key: state.key, dir: state.dir === "asc" ? "desc" : "asc" };
  }
  return { key: action.key, dir: defaultSortDir(action.key) };
}

function ImportsJobHistoryTable({ jobs }: Readonly<{ jobs: readonly ImportJobApiRow[] }>) {
  const [sort, dispatchSort] = useReducer(sortReducer, {
    key: "updated_at",
    dir: "desc",
  } satisfies SortState);

  const onSort = useCallback((key: SortKey) => {
    dispatchSort({ type: "sort", key });
  }, []);

  const sorted = useMemo(() => {
    if (jobs.length === 0) {
      return jobs;
    }
    return [...jobs].sort((a, b) => compareJobs(a, b, sort.key, sort.dir));
  }, [jobs, sort]);

  if (jobs.length === 0) {
    return (
      <p className="font-mono text-caption uppercase tracking-[0.04em] text-muted">
        No import job rows on file for this account.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-hairline">
            <SortableTh
              label="Kind"
              sortKey="kind"
              activeKey={sort.key}
              dir={sort.dir}
              onSort={onSort}
            />
            <SortableTh
              label="Label"
              sortKey="label"
              activeKey={sort.key}
              dir={sort.dir}
              onSort={onSort}
            />
            <SortableTh
              label="Last.fm"
              sortKey="lastfm"
              activeKey={sort.key}
              dir={sort.dir}
              onSort={onSort}
            />
            <SortableTh
              label="Stage"
              sortKey="stage"
              activeKey={sort.key}
              dir={sort.dir}
              onSort={onSort}
            />
            <SortableTh
              label="Rows"
              sortKey="rows"
              activeKey={sort.key}
              dir={sort.dir}
              onSort={onSort}
              align="right"
            />
            <SortableTh
              label="Pages"
              sortKey="pages"
              activeKey={sort.key}
              dir={sort.dir}
              onSort={onSort}
              align="right"
            />
            <SortableTh
              label="Total"
              sortKey="total"
              activeKey={sort.key}
              dir={sort.dir}
              onSort={onSort}
              align="right"
            />
            <SortableTh
              label="Updated"
              sortKey="updated_at"
              activeKey={sort.key}
              dir={sort.dir}
              onSort={onSort}
              align="right"
            />
          </tr>
        </thead>
        <tbody className="font-mono text-caption normal-case tracking-normal text-foreground">
          {sorted.map((j) => (
            <tr key={j.id} className="border-b border-hairline align-top">
              <td className="py-2 pr-3 uppercase tracking-[0.04em] text-muted">{sourceKind(j)}</td>
              <td className="max-w-[12rem] py-2 pr-3 break-words">{j.label}</td>
              <td className="py-2 pr-3 break-all">{j.lastfm_username}</td>
              <td
                className="py-2 pr-3 text-foreground"
                title={j.stage}
              >
                <span className="font-sans text-body normal-case tracking-normal">
                  {importPipelineStageShortLabel(j.stage)}
                </span>
                <span className="mt-0.5 block font-mono text-caption uppercase tracking-[0.04em] text-muted">
                  {j.stage}
                </span>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatCount(j.items_processed)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {formatCount(j.checkpoint_pages_completed)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {j.items_total === null ? "—" : formatCount(j.items_total)}
              </td>
              <td className="py-2 text-right whitespace-nowrap">
                <time dateTime={j.updated_at}>
                  <DashboardInstantTimestamp iso={j.updated_at} variant="precise" />
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DashboardImportPipelineExtras({
  jobHistory,
  jobHistoryPaging,
  listenSync,
}: Readonly<{
  jobHistory: readonly ImportJobApiRow[];
  jobHistoryPaging: ImportsPageJobHistoryPaging;
  listenSync: Readonly<{
    minIntervalSeconds: number;
    summary: ListenSyncSummaryForUser | null;
  }>;
}>) {
  const showDevRunnerHints = process.env.NODE_ENV === "development";
  const [tab, setTab] = useState<"history" | "sync">("history");

  const onTabArrowKey = useCallback((e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setTab((t) => (t === "history" ? "sync" : "history"));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setTab((t) => (t === "sync" ? "history" : "sync"));
    }
  }, []);

  return (
    <div className="overflow-hidden rounded-md border border-hairline bg-surface">
      <div
        className="flex flex-wrap gap-0 border-b border-hairline font-mono text-caption uppercase tracking-[0.08em]"
        role="tablist"
        aria-label="Import history and sync"
      >
        <button
          type="button"
          role="tab"
          id="imports-tab-history"
          aria-selected={tab === "history"}
          aria-controls="imports-panel-history"
          tabIndex={tab === "history" ? 0 : -1}
          className={`min-h-11 flex-1 px-4 py-3 text-center transition-colors sm:flex-none sm:px-8 ${
            tab === "history"
              ? "border-b-2 border-foreground bg-raised/30 text-foreground"
              : "text-muted hover:bg-raised/20 hover:text-foreground"
          }`}
          onClick={() => setTab("history")}
          onKeyDown={onTabArrowKey}
        >
          Run history
        </button>
        <button
          type="button"
          role="tab"
          id="imports-tab-sync"
          aria-selected={tab === "sync"}
          aria-controls="imports-panel-sync"
          tabIndex={tab === "sync" ? 0 : -1}
          className={`min-h-11 flex-1 px-4 py-3 text-center transition-colors sm:flex-none sm:px-8 ${
            tab === "sync"
              ? "border-b-2 border-foreground bg-raised/30 text-foreground"
              : "text-muted hover:bg-raised/20 hover:text-foreground"
          }`}
          onClick={() => setTab("sync")}
          onKeyDown={onTabArrowKey}
        >
          Background sync
        </button>
      </div>

      <div
        id="imports-panel-history"
        role="tabpanel"
        aria-labelledby="imports-tab-history"
        hidden={tab !== "history"}
        className="space-y-4 p-6 md:p-8"
      >
        <p className={panelSectionTitleClass}>All import runs</p>
        <p className="font-mono text-caption uppercase tracking-[0.04em] text-muted">
          {`Newest first from server · ${jobHistoryPaging.pageSize} rows per page · column headers sort this page`}
        </p>
        <ImportsJobHistoryTable jobs={jobHistory} />
        <ImportsJobHistoryPager paging={jobHistoryPaging} />
      </div>

      <div
        id="imports-panel-sync"
        role="tabpanel"
        aria-labelledby="imports-tab-sync"
        hidden={tab !== "sync"}
        className="p-6 md:p-8"
      >
        <ImportsListenSyncRunnerCard listenSync={listenSync} showDevRunnerHints={showDevRunnerHints} />
      </div>
    </div>
  );
}
