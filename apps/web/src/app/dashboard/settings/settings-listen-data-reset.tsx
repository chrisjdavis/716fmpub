"use client";

import { sanitizeUserFacingPlainText } from "@vs/domain/user-facing-plain-text";
import { useState } from "react";
import { browserCsrfHeaderRecord } from "@/lib/browser-csrf";

/** Must match {@link STEP_UP_PURPOSE_PURGE_LISTEN_DATA} in `@vs/db` (server-enforced). */
const PURGE_LISTEN_DATA_STEP_UP_PURPOSE = "purge_listen_data" as const;

type Props = Readonly<{
  confirmPhrase: string;
}>;

export function SettingsListenDataReset({ confirmPhrase }: Props) {
  const [input, setInput] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enabled =
    input.trim() === confirmPhrase && password.length > 0 && !pending;

  async function onPurge() {
    setError(null);
    setMessage(null);
    setPending(true);
    const csrf = await browserCsrfHeaderRecord();
    if (!csrf) {
      setPending(false);
      setError("Could not prepare a secure request. Refresh the page and try again.");
      return;
    }
    const stepRes = await fetch("/api/me/step-up", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrf },
      credentials: "include",
      body: JSON.stringify({
        password,
        purpose: PURGE_LISTEN_DATA_STEP_UP_PURPOSE,
      }),
    });
    if (!stepRes.ok) {
      setPending(false);
      let msg = `[ERROR: HTTP ${stepRes.status}]`;
      try {
        const body: unknown = await stepRes.json();
        if (body && typeof body === "object" && "error" in body) {
          const e = (body as Record<string, unknown>).error;
          if (typeof e === "string") {
            msg = e;
          }
        }
      } catch {
        /* keep */
      }
      setError(sanitizeUserFacingPlainText(msg));
      return;
    }
    let stepUpToken: string;
    try {
      const body: unknown = await stepRes.json();
      if (
        body &&
        typeof body === "object" &&
        "token" in body &&
        typeof (body as { token: unknown }).token === "string"
      ) {
        stepUpToken = (body as { token: string }).token;
      } else {
        setPending(false);
        setError("Step-up response did not include a token.");
        return;
      }
    } catch {
      setPending(false);
      setError("Step-up response did not include a token.");
      return;
    }

    const res = await fetch("/api/me/listen-data", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrf },
      credentials: "include",
      body: JSON.stringify({
        confirmPhrase: input.trim(),
        stepUpToken,
      }),
    });
    setPending(false);
    if (!res.ok) {
      let msg = `[ERROR: HTTP ${res.status}]`;
      try {
        const body: unknown = await res.json();
        if (body && typeof body === "object" && "error" in body) {
          const e = (body as Record<string, unknown>).error;
          if (typeof e === "string") {
            msg = e;
          }
        }
      } catch {
        /* keep */
      }
      setError(sanitizeUserFacingPlainText(msg));
      return;
    }
    setInput("");
    setPassword("");
    try {
      const body: unknown = await res.json();
      if (body && typeof body === "object" && "deleted" in body) {
        const d = (body as { deleted: Record<string, number> }).deleted;
        setMessage(
          `Removed ${d.listensDeleted ?? 0} listens, ${d.importJobsDeleted ?? 0} import job(s), ${d.analyticsSnapshotsDeleted ?? 0} analytics snapshot(s). You can queue a new import from the dashboard.`,
        );
      } else {
        setMessage("Listen and import data cleared. You can queue a new import from the dashboard.");
      }
    } catch {
      setMessage("Listen and import data cleared. You can queue a new import from the dashboard.");
    }
  }

  return (
    <section className="space-y-6 rounded-md bg-raised/40">
      <div className="space-y-2">
        <p className="font-mono text-label uppercase tracking-[0.08em] text-error">
          Danger zone
        </p>
        <h3 className="font-display text-display-sm text-error">Delete all data</h3>
        <p className="font-sans text-body text-foreground">
          Deletes every canonical listen, raw import row, import job, and analytics snapshot
          for your account. Your login and profile (email, display name, Last.fm username on
          file) are not removed. Shared catalog rows (<span className="font-mono">tracks</span>,{" "}
          <span className="font-mono">artists</span>, <span className="font-mono">albums</span>) stay
          in the database but are no longer linked to you. You must re-enter your account password;
          the server issues a short-lived, single-use step-up token for this action only.
        </p>
        <p className="font-mono text-caption uppercase tracking-[0.04em] text-muted">
          Use this after changing import parsers or to re-run a full Last.fm import. Start the
          worker before queueing a new job.
        </p>
      </div>
      <label className="block space-y-2">
        <span className="font-mono text-label uppercase tracking-[0.08em] text-muted">
          Type this phrase to enable reset
        </span>
        <input
          type="text"
          readOnly
          value={confirmPhrase}
          className="w-full cursor-text border-0 bg-raised px-4 py-3 font-mono text-caption text-foreground outline-none"
          aria-label="Confirmation phrase to copy"
          onFocus={(e) => e.currentTarget.select()}
        />
        <input
          type="text"
          autoComplete="off"
          placeholder="Paste the phrase here"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="vs-control focus-visible:ring-offset-0"
        />
      </label>
      <label className="block space-y-2">
        <span className="font-mono text-label uppercase tracking-[0.08em] text-muted">
          Account password (re-verification)
        </span>
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Enter your login password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="vs-control focus-visible:ring-offset-0"
        />
      </label>
      <div aria-live="polite" aria-atomic="true" className="space-y-2">
        {error ? (
          <p className="font-mono text-caption uppercase tracking-[0.04em] text-error">{error}</p>
        ) : null}
        {message ? (
          <p className="font-mono text-caption uppercase tracking-[0.04em] text-muted">{message}</p>
        ) : null}
      </div>
      <button
        type="button"
        disabled={!enabled}
        onClick={() => void onPurge()}
        className="border border-error bg-transparent px-8 py-3 font-mono text-label uppercase tracking-[0.1em] text-error transition-opacity hover:bg-error/10 disabled:opacity-40"
      >
        {pending ? "[WORKING…]" : "Delete all listen & import data"}
      </button>
    </section>
  );
}
