"use client";

import { sanitizeUserFacingPlainText } from "@vs/domain/user-facing-plain-text";
import { useCallback, useId, useState } from "react";
import { browserCsrfHeaderRecord } from "@/lib/browser-csrf";

type StatusBody = {
  stage: string;
  artifactAccess?: "none" | "available" | "expired";
  download: { href: string } | null;
  errorMessage: string | null;
  itemsProcessed?: number;
  itemsTotal?: number | null;
  pollAfterMs?: number;
  maxPollsHint?: number;
};

type PostBody = {
  exportJob: { id: string };
  statusPath: string;
};

const PREDOWNLOAD_MS = 480;

function clampPollMs(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 1200;
  }
  return Math.min(10_000, Math.max(500, Math.round(raw)));
}

function maxPollsFromHint(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 200;
  }
  return Math.min(500, Math.max(20, Math.round(raw)));
}

async function readJsonError(res: Response): Promise<string> {
  const raw = await res.json().catch(() => ({}));
  if (
    typeof raw === "object" &&
    raw !== null &&
    "error" in raw &&
    typeof (raw as { error?: unknown }).error === "string"
  ) {
    return sanitizeUserFacingPlainText((raw as { error: string }).error);
  }
  return sanitizeUserFacingPlainText(res.statusText || `HTTP ${res.status}`);
}

export function ListenExportStartButton({
  format,
  label,
  className,
}: Readonly<{
  format: "json" | "csv";
  label: string;
  className: string;
}>) {
  const statusId = useId();
  const errorId = useId();
  const [busy, setBusy] = useState(false);
  const [startingDownload, setStartingDownload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressHint, setProgressHint] = useState<string | null>(null);

  const controlsLocked = busy || startingDownload;

  const liveText = error
    ? ""
    : startingDownload
      ? "Download starting…"
      : progressHint
        ? progressHint
        : busy
          ? "Preparing export. This may take a moment."
          : "";

  const liveRegionVisible =
    Boolean(progressHint) || startingDownload;

  const onClick = useCallback(async () => {
    setError(null);
    setProgressHint(null);
    setStartingDownload(false);
    setBusy(true);
    try {
      const csrf = await browserCsrfHeaderRecord();
      if (!csrf) {
        throw new Error("Could not prepare a secure request. Refresh the page and try again.");
      }
      const res = await fetch("/api/export/listens", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrf },
        credentials: "include",
        body: JSON.stringify({ format }),
      });
      if (!res.ok) {
        throw new Error(await readJsonError(res));
      }
      const body = (await res.json()) as PostBody;
      const statusPath = body.statusPath;

      let pollMs = 1200;
      let maxPolls = 200;

      for (let i = 0; i < maxPolls; i += 1) {
        const st = await fetch(statusPath, { method: "GET", cache: "no-store" });
        if (!st.ok) {
          throw new Error(await readJsonError(st));
        }
        const js = (await st.json()) as StatusBody;
        if (i === 0) {
          pollMs = clampPollMs(js.pollAfterMs);
          maxPolls = maxPollsFromHint(js.maxPollsHint);
        }

        if (typeof js.itemsProcessed === "number" && js.itemsProcessed > 0) {
          const total =
            typeof js.itemsTotal === "number" && Number.isFinite(js.itemsTotal)
              ? js.itemsTotal
              : null;
          setProgressHint(
            total !== null ? `${js.itemsProcessed} / ${total} listens` : `${js.itemsProcessed} listens`,
          );
        } else if (js.stage === "running" || js.stage === "queued") {
          setProgressHint(null);
        }

        if (js.stage === "failed") {
          throw new Error(sanitizeUserFacingPlainText(js.errorMessage ?? "Export failed"));
        }
        if (js.stage === "expired" || js.artifactAccess === "expired") {
          throw new Error(
            sanitizeUserFacingPlainText(
              js.errorMessage ?? "This export has expired. Start a new export.",
            ),
          );
        }
        const downloadReady =
          Boolean(js.download?.href) &&
          (js.artifactAccess === "available" ||
            (js.artifactAccess === undefined && js.stage === "completed"));
        if (downloadReady && js.download?.href) {
          setProgressHint(null);
          setStartingDownload(true);
          await new Promise((r) => setTimeout(r, PREDOWNLOAD_MS));
          window.location.assign(js.download.href);
          return;
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
      throw new Error("Export is taking longer than expected. Try again in a few minutes.");
    } catch (e) {
      setError(
        sanitizeUserFacingPlainText(e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setBusy(false);
      setStartingDownload(false);
      setProgressHint(null);
    }
  }, [format]);

  return (
    <div className="flex w-full min-w-0 flex-col items-end gap-0">
      <button
        type="button"
        disabled={controlsLocked}
        aria-busy={controlsLocked}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onClick={onClick}
        className={className}
      >
        {startingDownload ? "[DOWNLOAD…]" : busy ? "[PREPARING…]" : label}
      </button>
      {!error && liveText.length > 0 ? (
        <div
          id={statusId}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={[
            "max-w-xs text-left font-mono text-base leading-relaxed",
            liveRegionVisible ? "mt-2 text-muted" : "sr-only",
          ].join(" ")}
        >
          {liveText}
        </div>
      ) : null}
      {error ? (
        <div
          id={errorId}
          role="alert"
          className="mt-2 max-w-xs text-left font-mono text-base leading-relaxed text-error"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
