"use client";

import { type FormEvent, useState } from "react";
import { signupFormShellClassName } from "@/app/access-layout";
import { useRouter } from "next/navigation";

export function ForgotPasswordForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const email = String(fd.get("email") ?? "");
    const res = await fetch("/api/auth/recovery/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setPending(false);
    if (!res.ok) {
      let errText = `[ERROR: HTTP ${res.status}]`;
      try {
        const body: unknown = await res.json();
        if (
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof (body as { error?: unknown }).error === "string"
        ) {
          errText = (body as { error: string }).error;
        }
      } catch {
        /* ignore */
      }
      setError(errText);
      return;
    }
    form.reset();
    router.push("/forgot-password/sent");
  }

  return (
    <form className={signupFormShellClassName} onSubmit={onSubmit}>
      <div className="space-y-4">
        <label className="block space-y-2">
          <span className="font-mono text-label uppercase tracking-[0.08em] text-muted">
            Email
          </span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="vs-control"
          />
        </label>
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
        {pending ? "[SENDING…]" : "Send recovery link"}
      </button>
    </form>
  );
}
