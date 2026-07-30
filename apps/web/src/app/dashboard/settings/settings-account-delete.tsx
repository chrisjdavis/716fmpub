"use client";

import { sanitizeUserFacingPlainText } from "@vs/domain/user-facing-plain-text";
import { useState } from "react";
import { browserCsrfHeaderRecord } from "@/lib/browser-csrf";

/** Must match {@link STEP_UP_PURPOSE_DELETE_ACCOUNT} in `@vs/db` (server-enforced). */
const DELETE_ACCOUNT_STEP_UP_PURPOSE = "delete_account" as const;

type Props = Readonly<{
  confirmPhrase: string;
}>;

export function SettingsAccountDelete({ confirmPhrase }: Props) {
  const [input, setInput] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = input.trim() === confirmPhrase && password.length > 0 && !pending;

  async function readErrorMessage(res: Response): Promise<string> {
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
    return sanitizeUserFacingPlainText(msg);
  }

  async function onDelete() {
    setError(null);
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
        purpose: DELETE_ACCOUNT_STEP_UP_PURPOSE,
      }),
    });
    if (!stepRes.ok) {
      setPending(false);
      setError(await readErrorMessage(stepRes));
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

    const res = await fetch("/api/me", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...csrf },
      credentials: "include",
      body: JSON.stringify({
        confirmPhrase: input.trim(),
        stepUpToken,
      }),
    });
    if (!res.ok) {
      setPending(false);
      setError(await readErrorMessage(res));
      return;
    }
    window.location.assign("/");
  }

  return (
    <section className="space-y-6 rounded-md border border-error/50 bg-error/5 p-5">
      <div className="space-y-2">
        <p className="font-mono text-label uppercase tracking-[0.08em] text-error">
          Account deletion
        </p>
        <h3 className="font-display text-display-sm text-error">Delete your account</h3>
        <p className="font-sans text-body text-foreground">
          Permanently deletes your login, sessions, tokens, profile fields, Last.fm API key,
          import history, listens, analytics snapshots, exports, and queued account work. Shared
          catalog rows such as artists, albums, and tracks may remain if other data references
          them, but they will no longer be linked to your account.
        </p>
      </div>
      <label className="block space-y-2">
        <span className="font-mono text-label uppercase tracking-[0.08em] text-muted">
          Type this phrase to enable account deletion
        </span>
        <input
          type="text"
          readOnly
          value={confirmPhrase}
          className="w-full cursor-text border-0 bg-raised px-4 py-3 font-mono text-caption text-foreground outline-none"
          aria-label="Account deletion confirmation phrase to copy"
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
      <div aria-live="polite" aria-atomic="true">
        {error ? (
          <p className="font-mono text-caption uppercase tracking-[0.04em] text-error">{error}</p>
        ) : null}
      </div>
      <button
        type="button"
        disabled={!enabled}
        onClick={() => void onDelete()}
        className="border border-error bg-error px-8 py-3 font-mono text-label uppercase tracking-[0.1em] text-surface transition-opacity hover:bg-error/90 disabled:opacity-40"
      >
        {pending ? "[DELETING…]" : "Delete account permanently"}
      </button>
    </section>
  );
}
