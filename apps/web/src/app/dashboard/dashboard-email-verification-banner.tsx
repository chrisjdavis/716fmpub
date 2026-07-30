"use client";

import { sanitizeUserFacingPlainText } from "@vs/domain/user-facing-plain-text";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserCsrfHeaderRecord } from "@/lib/browser-csrf";
import { readUserFacingErrorFromResponse } from "@/lib/read-user-facing-api-error";

type Props = Readonly<{
  email: string;
}>;

export function DashboardEmailVerificationBanner({ email }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function resend() {
    setError(null);
    setStatus(null);
    setPending(true);
    try {
      const csrf = await browserCsrfHeaderRecord();
      if (!csrf) {
        setError("Could not prepare a secure request. Refresh the page and try again.");
        return;
      }
      const res = await fetch("/api/me/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrf },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setError(sanitizeUserFacingPlainText(await readUserFacingErrorFromResponse(res)));
        return;
      }
      const body: unknown = await res.json();
      const dispatch =
        body &&
        typeof body === "object" &&
        "emailVerificationDispatch" in body &&
        (body as { emailVerificationDispatch?: unknown }).emailVerificationDispatch;
      if (
        dispatch &&
        typeof dispatch === "object" &&
        "status" in dispatch &&
        (dispatch as { status: string }).status === "sent"
      ) {
        setStatus("[VERIFICATION EMAIL SENT — CHECK INBOX]");
        return;
      }
      if (
        dispatch &&
        typeof dispatch === "object" &&
        "status" in dispatch &&
        (dispatch as { status: string }).status === "skipped"
      ) {
        setStatus(
          "[EMAIL NOT SENT — SERVER MAIL OR PUBLIC ORIGIN IS NOT CONFIGURED — USE VERIFY LINK FROM SIGNUP OR CONTACT SUPPORT]",
        );
        return;
      }
      if (
        dispatch &&
        typeof dispatch === "object" &&
        "status" in dispatch &&
        (dispatch as { status: string }).status === "failed"
      ) {
        setStatus("[EMAIL SEND FAILED — TRY AGAIN SHORTLY OR CONTACT SUPPORT]");
        return;
      }
      setStatus("[REQUEST ACCEPTED]");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="bg-surface px-6 py-5 md:py-6" role="region" aria-label="Email verification required">
      <div className="mx-auto flex max-w-app-content flex-col gap-6">
        <div className="min-w-0 space-y-2">
          <p className="font-mono text-label uppercase tracking-[0.08em] text-overline">
            Email not verified
          </p>
          <p className="font-sans text-body text-foreground">
            We sent a link to{" "}
            <span className="font-mono text-caption normal-case tracking-normal text-foreground">
              {sanitizeUserFacingPlainText(email)}
            </span>
            . Listening history, imports, and exports stay locked until you confirm. After
            verifying, continue setup below to connect Last.fm and run your first import.
          </p>
          {error ? (
            <p className="font-mono text-caption uppercase tracking-[0.04em] text-error">{error}</p>
          ) : null}
          {status ? (
            <p className="font-mono text-caption uppercase tracking-[0.04em] text-muted">{status}</p>
          ) : null}
        </div>
        <div className="flex w-full min-w-0 shrink-0 flex-row flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => void resend()}
            className="border border-wire bg-transparent px-6 py-3 font-mono text-label uppercase tracking-[0.1em] text-foreground transition-opacity hover:bg-raised disabled:opacity-40"
          >
            {pending ? "[SENDING…]" : "Resend verification email"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/verify-email")}
            className="border border-hairline bg-raised px-6 py-3 font-mono text-label uppercase tracking-[0.1em] text-foreground transition-opacity hover:opacity-90"
          >
            Open verify page
          </button>
        </div>
      </div>
    </div>
  );
}
