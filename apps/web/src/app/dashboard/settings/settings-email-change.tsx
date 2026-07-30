"use client";

import { sanitizeUserFacingPlainText } from "@vs/domain/user-facing-plain-text";
import { useState } from "react";
import { browserCsrfHeaderRecord } from "@/lib/browser-csrf";

/** Must match {@link STEP_UP_PURPOSE_CHANGE_ACCOUNT_EMAIL} in `@vs/db`. */
const CHANGE_EMAIL_STEP_UP_PURPOSE = "change_account_email" as const;

type Props = Readonly<{
  currentEmail: string;
  emailVerified: boolean;
}>;

export function SettingsEmailChange({ currentEmail, emailVerified }: Props) {
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabled =
    emailVerified && newEmail.trim().length > 0 && password.length > 0 && !pending;

  async function onRequestChange() {
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
        purpose: CHANGE_EMAIL_STEP_UP_PURPOSE,
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

    const res = await fetch("/api/me/email-change/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrf },
      credentials: "include",
      body: JSON.stringify({
        newEmail: newEmail.trim(),
        stepUpToken,
      }),
    });
    setPending(false);
    setPassword("");
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
    setNewEmail("");
    setMessage(
      "Check the new inbox for a confirmation link. Your sign-in email does not change until you complete that step. The address on file also receives a short security notice.",
    );
  }

  if (!emailVerified) {
    return (
      <div className="w-full max-w-none space-y-3 py-2">
        <p className="font-mono text-label uppercase tracking-[0.08em] text-overline">Email change</p>
        <p className="font-sans text-body text-foreground">
          Verify your current email from the dashboard banner before you can request a change. That
          keeps recovery and notifications tied to an address you control.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none space-y-8 py-2">
      <div className="space-y-2">
        <p className="font-mono text-label uppercase tracking-[0.08em] text-overline">Email change</p>
        <p className="font-sans text-body text-secondary">
          Current sign-in email:{" "}
          <span className="font-mono text-caption normal-case tracking-normal text-foreground">
            {sanitizeUserFacingPlainText(currentEmail)}
          </span>
        </p>
        <p className="font-sans text-body text-foreground">
          Enter the new address and your account password. We send a confirmation link only to the
          new inbox; the current address gets a security heads-up.
        </p>
      </div>
      <label className="block space-y-2">
        <span className="font-mono text-label uppercase tracking-[0.08em] text-muted">
          New email
        </span>
        <input
          type="email"
          autoComplete="email"
          value={newEmail}
          onChange={(ev) => setNewEmail(ev.target.value)}
          maxLength={320}
          className="vs-control"
        />
      </label>
      <label className="block space-y-2">
        <span className="font-mono text-label uppercase tracking-[0.08em] text-muted">
          Current password
        </span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(ev) => setPassword(ev.target.value)}
          maxLength={256}
          className="vs-control"
        />
      </label>
      <div aria-live="polite" aria-atomic="true" className="space-y-2">
        {error ? (
          <p className="font-mono text-caption uppercase tracking-[0.04em] text-error">{error}</p>
        ) : null}
        {message ? (
          <p className="font-sans text-body text-foreground">
            {sanitizeUserFacingPlainText(message)}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        disabled={!enabled}
        onClick={() => void onRequestChange()}
        className="border border-wire bg-transparent px-8 py-3 font-mono text-label uppercase tracking-[0.1em] text-foreground transition-opacity hover:bg-raised disabled:opacity-40"
      >
        {pending ? "[SENDING…]" : "Request email change"}
      </button>
    </div>
  );
}
