"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserCsrfHeaderRecord } from "@/lib/browser-csrf";

function defaultImportLabel(): string {
  const u = new Date().toISOString();
  return `Listen import ${u.slice(0, 16)}`;
}

type Props = Readonly<{
  lastfmUsername: string;
}>;

/**
 * Queues `POST /api/imports` using the profile username (explicit body; never inferred from label).
 */
export function DashboardQueueImport({ lastfmUsername }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [line, setLine] = useState<string | null>(null);

  async function queue() {
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
        label: defaultImportLabel(),
        lastfmUsername,
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
        onClick={() => void queue()}
        className="border border-wire bg-raised px-8 py-3 font-mono text-label uppercase tracking-[0.1em] text-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "[QUEUING…]" : "Queue Last.fm import"}
      </button>
      <p className="font-mono text-caption uppercase tracking-[0.04em] text-muted">
        Runs against the username shown on this screen. Start the import worker (npm run
        dev:worker from the repo root). Use your Last.fm API key from Settings, or set
        LASTFM_API_KEY in the root .env for a shared worker key.
      </p>
      {line ? (
        <p className="font-mono text-caption uppercase tracking-[0.04em] text-error">
          {line}
        </p>
      ) : null}
    </div>
  );
}
