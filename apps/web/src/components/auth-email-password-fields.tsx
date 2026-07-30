"use client";

import { useId, type ReactNode } from "react";

/**
 * Grid (not flex-on-input) so controls aren’t sized by the browser’s default `input` min-content
 * width (~20ch) — that bug made sign-in fields look much narrower than the column.
 */
const fieldStackClassName = "grid w-full min-w-0 grid-cols-1 gap-4";

const rowClassName = "grid w-full min-w-0 grid-cols-1 gap-2";

const labelTextClassName = "font-mono text-label uppercase tracking-[0.08em] text-muted";

/** Hint must never set column width: full line + wrap, never max-content shrink. */
const hintClassName =
  "w-full min-w-0 max-w-full whitespace-normal font-mono text-caption uppercase tracking-[0.04em] text-muted";

type Props = {
  hint: ReactNode;
  hintId?: string;
  emailAriaDescribedBy?: string;
  passwordAutoComplete: "new-password" | "current-password";
  passwordMinLength?: number;
  passwordMaxLength?: number;
};

/** One markup path for `/login` and `/setup` — do not fork this layout. */
export function AuthEmailPasswordFields({
  hint,
  hintId,
  emailAriaDescribedBy,
  passwordAutoComplete,
  passwordMinLength,
  passwordMaxLength,
}: Props) {
  const rid = useId();
  const emailId = `${rid}-email`;
  const passwordId = `${rid}-password`;

  return (
    <div className={fieldStackClassName}>
      <div className={rowClassName}>
        <label htmlFor={emailId} className={labelTextClassName}>
          Email
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-describedby={emailAriaDescribedBy}
          className="vs-control"
        />
      </div>
      <div className={rowClassName}>
        <label htmlFor={passwordId} className={labelTextClassName}>
          Password
        </label>
        <input
          id={passwordId}
          name="password"
          type="password"
          autoComplete={passwordAutoComplete}
          required
          {...(passwordMinLength !== undefined ? { minLength: passwordMinLength } : {})}
          {...(passwordMaxLength !== undefined ? { maxLength: passwordMaxLength } : {})}
          className="vs-control"
        />
      </div>
      <p id={hintId} className={hintClassName}>
        {hint}
      </p>
    </div>
  );
}
