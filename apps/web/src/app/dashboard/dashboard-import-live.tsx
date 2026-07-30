"use client";

import { sanitizeUserFacingPlainText } from "@vs/domain/user-facing-plain-text";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ImportJobApiRow } from "@/server/api/import-job-row";
import { DashboardSegmentedProgress } from "./dashboard-segmented-progress";
import {
  importJobItemsTotalKnown,
  importJobShowsSegmentedProgressBar,
} from "./import-job-progress-helpers";
import { formatCount } from "./format-count";
import { DashboardInstantTimestamp } from "./dashboard-instant-timestamp";
import { importPipelineStageSentence } from "./import-pipeline-stage-label";
import { parseImportLatestGetJson } from "./import-latest-response";

function ImportProgressReadout({
  job,
  pollLine,
}: Readonly<{ job: ImportJobApiRow; pollLine: string | null }>) {
  const itemsTotal = job.items_total;
  const totalKnown = importJobItemsTotalKnown(itemsTotal);
  const showBar = importJobShowsSegmentedProgressBar(itemsTotal);
  const totalDisplay = totalKnown ? formatCount(itemsTotal) : "—";
  const primary = `${formatCount(job.items_processed)} / ${totalDisplay}`;

  return (
    <div className="space-y-10 text-left">
      <div>
        <p className="font-display text-display-xl tabular-nums tracking-tight text-display">
          {primary}
        </p>
        <p className="mt-3 max-w-md font-sans text-body text-foreground">
          Importing your listening history
        </p>
      </div>

      <dl className="grid gap-8 border-t border-hairline pt-10 font-mono text-caption uppercase tracking-[0.08em] text-muted sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <dt>Source</dt>
          <dd className="font-sans text-body normal-case tracking-normal text-foreground">
            {job.source === "system_sync" ? "Background sync" : "Manual import"}
          </dd>
        </div>
        <div className="space-y-2">
          <dt>Pages persisted</dt>
          <dd className="font-sans text-body tabular-nums normal-case tracking-normal text-foreground">
            {formatCount(job.checkpoint_pages_completed)}
          </dd>
        </div>
        <div className="space-y-2">
          <dt>Status</dt>
          <dd
            className="font-sans text-body normal-case tracking-normal text-foreground"
            title={job.stage}
          >
            {importPipelineStageSentence(job.stage)}
            <span className="mt-1 block font-mono text-caption uppercase tracking-[0.04em] text-muted">
              {job.stage}
            </span>
          </dd>
        </div>
        <div className="space-y-2">
          <dt>
            <span className="block">Checkpoint</span>
            <span className="mt-1 block font-mono text-caption normal-case tracking-[0.04em] text-muted">
              Oldest listen timestamp on the last fully saved page (Unix seconds,{" "}
              <abbr title="Unix timestamp">uts</abbr>)
            </span>
          </dt>
          <dd className="font-sans text-body tabular-nums normal-case tracking-normal text-foreground">
            {job.checkpoint_oldest_uts ?? "—"}
          </dd>
        </div>
      </dl>

      {!totalKnown ? (
        <p className="font-mono text-caption uppercase tracking-[0.06em] text-warning">
          Catalogue total is not available from Last.fm in this mode; row and page counts come from
          the server checkpoint only.
        </p>
      ) : null}

      {showBar ? (
        <DashboardSegmentedProgress processed={job.items_processed} total={itemsTotal} />
      ) : null}

      <p className="font-mono text-caption uppercase tracking-[0.06em] text-muted">
        Updated{" "}
        <time className="normal-case" dateTime={job.updated_at}>
          <DashboardInstantTimestamp iso={job.updated_at} variant="precise" />
        </time>
      </p>

      {pollLine ? (
        <p className="font-mono text-caption uppercase tracking-[0.06em] text-error">{pollLine}</p>
      ) : null}
    </div>
  );
}

type Props = Readonly<{
  initialJob: ImportJobApiRow;
}>;

export function DashboardImportLive({ initialJob }: Props) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [pollLine, setPollLine] = useState<string | null>(null);

  useEffect(() => {
    setJob(initialJob);
  }, [initialJob]);

  useEffect(() => {
    let cancelled = false;
    async function pull() {
      const res = await fetch("/api/imports/latest", { credentials: "include" });
      if (cancelled) {
        return;
      }
      if (!res.ok) {
        let msg = `[ERROR: HTTP ${res.status}]`;
        try {
          const raw: unknown = await res.json();
          if (raw && typeof raw === "object" && "error" in raw) {
            const err = (raw as Record<string, unknown>).error;
            if (typeof err === "string" && err.trim()) {
              msg = `[ERROR: ${sanitizeUserFacingPlainText(err.trim())}]`;
            }
          }
        } catch {
          /* keep */
        }
        setPollLine(msg);
        return;
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        setPollLine("[ERROR: INVALID JSON BODY]");
        return;
      }
      const parsed = parseImportLatestGetJson(json);
      if (!parsed.ok) {
        setPollLine(parsed.error);
        return;
      }
      if (parsed.latest === null) {
        setPollLine("[IMPORT STATE MISSING FROM SERVER]");
        router.refresh();
        return;
      }
      setPollLine(null);
      setJob(parsed.latest);
      if (parsed.latest.stage !== "queued" && parsed.latest.stage !== "running") {
        router.refresh();
      }
    }
    void pull();
    const id = setInterval(() => void pull(), 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [router]);

  return <ImportProgressReadout job={job} pollLine={pollLine} />;
}
