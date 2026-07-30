"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  signupAccessPageSectionCompactClassName,
  signupFormShellClassName,
} from "@/app/access-layout";
import { verifyEmailChangeOnce } from "./verify-email-change-inflight";

type State =
  | { kind: "loading" }
  | { kind: "success"; email: string }
  | { kind: "error"; message: string; code?: string };

type Props = {
  token: string;
};

export function VerifyEmailChangeClient({ token }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { ok, status, json: body } = await verifyEmailChangeOnce(token);
      if (cancelled) {
        return;
      }
      if (!ok) {
        const code =
          body &&
          typeof body === "object" &&
          "code" in body &&
          typeof (body as { code?: unknown }).code === "string"
            ? (body as { code: string }).code
            : undefined;
        const message =
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : `[ERROR: HTTP ${status}]`;
        setState({ kind: "error", message, code });
        return;
      }
      if (
        body &&
        typeof body === "object" &&
        "ok" in body &&
        (body as { ok?: unknown }).ok === true &&
        "email" in body &&
        typeof (body as { email?: unknown }).email === "string"
      ) {
        setState({
          kind: "success",
          email: (body as { email: string }).email,
        });
        return;
      }
      setState({
        kind: "error",
        message:
          "The server returned an unexpected response. Try again or open the link from your email again.",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.kind === "loading") {
    return (
      <p className="font-mono text-caption uppercase tracking-[0.04em] text-muted">[CONFIRMING…]</p>
    );
  }

  if (state.kind === "success") {
    return (
      <div className={signupFormShellClassName}>
        <div className="space-y-3">
          <p className="font-display text-display-md text-display">Email updated</p>
          <p className="font-sans text-body text-foreground">
            Your sign-in email is now the address you confirmed. Use it the next time you sign in.
          </p>
          <p className="font-mono text-caption uppercase tracking-[0.06em] text-muted">
            {state.email}
          </p>
        </div>
        <Link href="/dashboard" className="vs-btn-primary">
          Continue to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className={signupAccessPageSectionCompactClassName}>
      <p className="font-display text-display-sm text-display">Change did not complete</p>
      <p className="font-mono text-caption uppercase tracking-[0.04em] text-error" role="alert">
        {state.message}
      </p>
      {state.code ? (
        <p className="font-mono text-caption uppercase tracking-[0.06em] text-muted">
          [{state.code.toUpperCase().replaceAll("_", " ")}]
        </p>
      ) : null}
      <p className="font-sans text-body text-secondary">
        If the link has expired, sign in with your current email, open settings, and start the change
        again from the account section.
      </p>
      <Link
        href="/login"
        className="inline-flex font-mono text-label uppercase tracking-[0.08em] text-interactive no-underline hover:underline"
      >
        Sign in
      </Link>
    </div>
  );
}
