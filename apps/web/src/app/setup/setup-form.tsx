"use client";

import { type FormEvent, useEffect, useState } from "react";
import { AuthEmailPasswordFields } from "@/components/auth-email-password-fields";
import { signupFormShellClassName } from "@/app/access-layout";
import { readBrowserCsrfCookieValue } from "@/lib/browser-csrf";
import { readUserFacingErrorFromResponse } from "@/lib/read-user-facing-api-error";
import { API_CSRF_HEADER_NAME } from "@vs/domain/auth-csrf-header";

export function SetupForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [bootstrapSecretRequired, setBootstrapSecretRequired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/setup", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (!cancelled && res.ok) {
          const body = (await res.json()) as { bootstrapSecretRequired?: boolean };
          setBootstrapSecretRequired(Boolean(body.bootstrapSecretRequired));
        }
      } catch {
        // Form still usable; server enforces secret when configured.
      }
      if (!cancelled) {
        setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const form = e.currentTarget;
      const fd = new FormData(form);
      const email = String(fd.get("email") ?? "");
      const password = String(fd.get("password") ?? "");
      const bootstrapSecret = String(fd.get("bootstrapSecret") ?? "").trim();
      let csrf = readBrowserCsrfCookieValue();
      if (!csrf) {
        const boot = await fetch("/api/auth/setup", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (!boot.ok) {
          setError("Could not prepare a secure setup session. Refresh and try again.");
          return;
        }
        csrf = readBrowserCsrfCookieValue();
      }
      if (!csrf) {
        setError("Could not prepare a secure setup session. Refresh and try again.");
        return;
      }
      const body: Record<string, string> = { email, password };
      if (bootstrapSecret) {
        body.bootstrapSecret = bootstrapSecret;
      }
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [API_CSRF_HEADER_NAME]: csrf,
        },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await readUserFacingErrorFromResponse(res));
        return;
      }
      window.location.assign("/dashboard");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={signupFormShellClassName} method="post" onSubmit={onSubmit}>
      <AuthEmailPasswordFields
        hint="Minimum 12 characters, at least two distinct characters. This creates the sole owner account for your instance."
        passwordAutoComplete="new-password"
        passwordMinLength={12}
      />
      <label className="flex flex-col gap-2">
        <span className="font-mono text-label uppercase tracking-[0.08em] text-overline">
          Bootstrap secret
          {bootstrapSecretRequired ? " (required)" : " (if configured)"}
        </span>
        <input
          name="bootstrapSecret"
          type="password"
          autoComplete="off"
          required={bootstrapSecretRequired}
          className="vs-control"
          placeholder="VS_SETUP_BOOTSTRAP_SECRET"
        />
        <span className="font-mono text-caption uppercase tracking-[0.04em] text-muted">
          Matches the server env var that prevents unauthenticated instance claim.
        </span>
      </label>
      {error ? (
        <p
          className="font-mono text-caption uppercase tracking-[0.04em] text-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || !hydrated}
        className="vs-btn-primary self-start"
      >
        {pending ? "[CREATING ACCOUNT…]" : "Create owner account"}
      </button>
    </form>
  );
}
