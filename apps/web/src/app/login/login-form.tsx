"use client";

import { type FormEvent, useState } from "react";
import { AuthEmailPasswordFields } from "@/components/auth-email-password-fields";
import { signupFormShellClassName } from "@/app/access-layout";
import { readUserFacingErrorFromResponse } from "@/lib/read-user-facing-api-error";

type Props = {
  nextPath: string;
};

export function LoginForm({ nextPath }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const form = e.currentTarget;
      const fd = new FormData(form);
      const email = String(fd.get("email") ?? "");
      const password = String(fd.get("password") ?? "");
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        setError(await readUserFacingErrorFromResponse(res));
        return;
      }
      window.location.assign(nextPath);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={signupFormShellClassName} onSubmit={onSubmit} aria-busy={pending}>
      <AuthEmailPasswordFields
        hint="Use the same email you signed up with."
        hintId="login-email-hint"
        emailAriaDescribedBy="login-email-hint"
        passwordAutoComplete="current-password"
        passwordMaxLength={256}
      />
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
        disabled={pending}
        className="vs-btn-primary self-start"
      >
        {pending ? "[SIGNING IN…]" : "Sign in"}
      </button>
    </form>
  );
}
