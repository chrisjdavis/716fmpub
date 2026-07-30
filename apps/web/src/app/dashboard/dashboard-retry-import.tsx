"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserCsrfHeaderRecord } from "@/lib/browser-csrf";
import type { ImportJobApiRow } from "@/server/api/import-job-row";

type Props = Readonly<{
  job: ImportJobApiRow;
}>;

export function DashboardRetryImport({ job }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [line, setLine] = useState<string | null>(null);

  async function queueRetry() {
    setLine(null);
    setPending(true);
    const csrf = await browserCsrfHeaderRecord();
    if (!csrf) {
      setPending(false);
      setLine("Could not prepare a secure request. Refresh the page and try again.");
      return;
    }
    const res = await fetch("/api/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrf },
      credentials: "include",
      body: JSON.stringify({
        label: `Retry — ${job.label}`,
        lastfmUsername: job.lastfm_username,
      }),
    });
    setPending(false);
    if (!res.ok) {
      let message = `[ERROR: HTTP ${res.status}]`;
      try {
        const body: unknown = await res.json();
        if (body && typeof body === "object" && "error" in body) {
          const err = (body as Record<string, unknown>).error;
          if (typeof err === "string") {
            message = err;
          }
        }
      } catch {
        /* ignore */
      }
      setLine(message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        disabled={pending}
        onClick={() => void queueRetry()}
        className="border border-wire bg-transparent px-8 py-3 font-mono text-label uppercase tracking-[0.1em] text-foreground transition-opacity hover:bg-raised disabled:opacity-40"
      >
        {pending ? "[QUEUING…]" : "Queue retry import"}
      </button>
      {line ? (
        <p className="font-mono text-caption uppercase tracking-[0.04em] text-error">
          {line}
        </p>
      ) : null}
    </div>
  );
}
