"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { API_CSRF_HEADER_NAME } from "@vs/domain/auth-csrf-header";
import { ensureBrowserCsrfCookieValue } from "@/lib/browser-csrf";

const buttonReset =
  "m-0 cursor-pointer appearance-none border-0 bg-transparent p-0 font-inherit text-inherit shadow-none";

export function LogoutForm({
  buttonClassName,
  formClassName,
}: Readonly<{
  /** Optional; defaults to dashboard-style link button. */
  buttonClassName?: string;
  /** Optional; keeps the control inline with sibling nav links (form is a flex child). */
  formClassName?: string;
}>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const token = await ensureBrowserCsrfCookieValue();
    if (!token) {
      setPending(false);
      setError("Could not prepare secure logout. Refresh the page and try again.");
      return;
    }
    const res = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        [API_CSRF_HEADER_NAME]: token,
      },
      body: JSON.stringify({}),
    });
    setPending(false);
    if (!res.ok) {
      setError("Logout failed.");
      return;
    }
    router.refresh();
    router.push("/login");
  }

  return (
    <form
      onSubmit={onSubmit}
      className={formClassName ?? "m-0 inline-flex items-center p-0"}
    >
      {error ? (
        <span className="sr-only" role="alert">
          {error}
        </span>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className={
          buttonClassName
            ? `${buttonReset} ${buttonClassName}`
            : `${buttonReset} font-mono text-caption uppercase tracking-[0.06em] text-interactive underline-offset-4 hover:underline`
        }
      >
        {pending ? "…" : "Log out"}
      </button>
    </form>
  );
}
