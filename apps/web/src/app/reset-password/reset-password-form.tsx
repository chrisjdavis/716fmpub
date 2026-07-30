"use client";

import { type FormEvent, useState } from "react";
import { signupFormShellClassName } from "@/app/access-layout";

type Props = {
  token: string;
};

export function ResetPasswordForm({ token }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const password = String(fd.get("password") ?? "");
    const res = await fetch("/api/auth/recovery/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setPending(false);
    if (!res.ok) {
      try {
        const body: unknown = await res.json();
        if (body && typeof body === "object" && "code" in body) {
          const code = (body as { code?: unknown }).code;
          if (code === "expired") {
            window.location.assign("/reset-password/expired");
            return;
          }
          if (code === "replayed") {
            window.location.assign("/reset-password/invalid?reason=replayed");
            return;
          }
          if (code === "invalid_token") {
            window.location.assign("/reset-password/invalid?reason=invalid");
            return;
          }
        }
        let message = "We could not update your password. Try again in a moment.";
        if (
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof (body as { error?: unknown }).error === "string"
        ) {
          message = (body as { error: string }).error;
        }
        setError(message);
      } catch {
        setError("We could not update your password. Try again in a moment.");
      }
      return;
    }
    window.location.assign("/reset-password/complete");
  }

  return (
    <form className={signupFormShellClassName} onSubmit={onSubmit}>
      <div className="space-y-4">
        <label className="block space-y-2">
          <span className="font-mono text-label uppercase tracking-[0.08em] text-muted">
            New password
          </span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            className="vs-control"
          />
        </label>
        <p className="font-mono text-caption uppercase tracking-[0.04em] text-muted">
          Minimum 12 characters, at least two distinct characters.
        </p>
      </div>
      {error ? (
        <p className="font-mono text-caption uppercase tracking-[0.04em] text-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="vs-btn-primary"
      >
        {pending ? "[UPDATING…]" : "Update password"}
      </button>
    </form>
  );
}
