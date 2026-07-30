"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  signupAccessPageSectionClassName,
  signupFormShellClassName,
} from "@/app/access-layout";
import { verifyEmailOnce } from "./verify-email-inflight";

type VerifyState =
  | { kind: "loading" }
  | { kind: "success"; email: string; newlyVerified: boolean }
  | { kind: "error"; message: string; code?: string };

type Props = {
  token: string;
};

function failureHeadline(code: string | undefined): string {
  switch (code) {
    case "expired":
      return "This verification link expired";
    case "replayed":
      return "This link was already used";
    case "invalid_token":
      return "This verification link cannot be used";
    default:
      return "Email verification did not complete";
  }
}

export function VerifyEmailClient({ token }: Props) {
  const [state, setState] = useState<VerifyState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { ok, status, json: body } = await verifyEmailOnce(token);
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
            : status === 429
              ? "Too many attempts right now. Wait a few minutes, then open the link from your email again."
              : "We could not confirm your email. Try opening the link from your latest message, or sign in and resend verification.";
        setState({ kind: "error", message, code });
        return;
      }
      if (
        body &&
        typeof body === "object" &&
        "ok" in body &&
        (body as { ok?: unknown }).ok === true &&
        "email" in body &&
        typeof (body as { email?: unknown }).email === "string" &&
        "newlyVerified" in body &&
        typeof (body as { newlyVerified?: unknown }).newlyVerified === "boolean"
      ) {
        setState({
          kind: "success",
          email: (body as { email: string }).email,
          newlyVerified: (body as { newlyVerified: boolean }).newlyVerified,
        });
        return;
      }
      setState({
        kind: "error",
        message:
          "The server returned an unexpected response. Try again, or open the link from your email once more.",
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
    const primary = state.newlyVerified ? "Email verified" : "Email already verified";
    const secondary = state.newlyVerified
      ? "Your address is confirmed. You can continue with your account."
      : "No further action is required for this address.";
    return (
      <div className={signupAccessPageSectionClassName}>
        <div className="space-y-4">
          <p className="font-display text-display-md text-display">{primary}</p>
          <p className="font-sans text-body text-foreground">{secondary}</p>
          <p className="font-mono text-caption uppercase tracking-[0.06em] text-secondary">
            {state.email}
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
          <Link href="/dashboard" className="vs-btn-primary">
            Continue to dashboard
          </Link>
          <Link
            href="/login"
            className="font-mono text-label uppercase tracking-[0.08em] text-interactive no-underline hover:underline"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const knownCode = state.code === "expired" || state.code === "invalid_token" || state.code === "replayed";

  return (
    <div className={signupFormShellClassName}>
      <div className="space-y-4">
        <p className="font-display text-display-md text-display">{failureHeadline(state.code)}</p>
        <p className="font-sans text-body text-foreground">{state.message}</p>
      </div>
      <div className="space-y-4 font-sans text-body-sm text-secondary">
        {state.code === "expired" ? (
          <p>
            Sign in with this account, open the dashboard, and choose &quot;Resend verification
            email&quot; from the banner while your address is still unconfirmed.
          </p>
        ) : null}
        {state.code === "replayed" || state.code === "invalid_token" ? (
          <p>
            If you already verified, sign in. Otherwise request a fresh verification email from the
            dashboard after you sign in.
          </p>
        ) : null}
        {!knownCode ? (
          <p>
            If you are not sure what happened, sign in from a trusted device. You can resend
            verification from the dashboard when your address is still pending.
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
        <Link href="/login" className="vs-btn-primary">
          Sign in
        </Link>
        <Link
          href="/login"
          className="font-mono text-label uppercase tracking-[0.08em] text-interactive no-underline hover:underline"
        >
          Create an account
        </Link>
      </div>
    </div>
  );
}
