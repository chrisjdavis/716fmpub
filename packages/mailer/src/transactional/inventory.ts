/**
 * Canonical transactional email kinds for the production account system.
 * Human-readable inventory: `docs/transactional-email-inventory.md`.
 */
export const TRANSACTIONAL_EMAIL_KINDS = [
  "signup_email_verification",
  "email_change_verification",
  "email_change_attempt_notice",
  "password_reset",
  "password_changed_confirmation",
  "welcome",
  "security_new_sign_in_notice",
  "onboarding_import_ready",
] as const;

export type TransactionalEmailKind = (typeof TRANSACTIONAL_EMAIL_KINDS)[number];

export type TransactionalEmailInventoryRow = Readonly<{
  kind: TransactionalEmailKind;
  /** Product event that enqueues or sends the message. */
  trigger: string;
  /** Who receives the message. */
  recipient: string;
  /** Stable subject line (no PII); renderers may append non-sensitive context later if the contract allows. */
  subject: string;
  /** Owning implementation package for HTML/text templates. */
  templateOwner: "@vs/mailer";
}>;

export const TRANSACTIONAL_EMAIL_INVENTORY: readonly TransactionalEmailInventoryRow[] = [
  {
    kind: "signup_email_verification",
    trigger:
      "User completes signup (or requests verification) and the server issues an email-bound verification token.",
    recipient: "The address being verified (account holder).",
    subject: "Confirm your email",
    templateOwner: "@vs/mailer",
  },
  {
    kind: "email_change_verification",
    trigger:
      "An authenticated user completes password step-up and requests an account email change; the server issues a token delivered only to the proposed new address.",
    recipient: "The proposed new account email (not trusted until the link is consumed).",
    subject: "Confirm your new email",
    templateOwner: "@vs/mailer",
  },
  {
    kind: "email_change_attempt_notice",
    trigger:
      "After a successful step-up for email change, the server notifies the prior account email that a change was started (the prior inbox is not the verification target).",
    recipient: "The account email address on file before any successful change completes.",
    subject: "Email change started",
    templateOwner: "@vs/mailer",
  },
  {
    kind: "password_reset",
    trigger:
      "User requests password recovery for an existing account and the server issues a fresh recovery token.",
    recipient: "Account holder at the account email address.",
    subject: "Reset your password",
    templateOwner: "@vs/mailer",
  },
  {
    kind: "password_changed_confirmation",
    trigger:
      "User successfully completes a password change (self-service recovery, authenticated settings change, or admin reset when modeled the same way).",
    recipient: "Account holder at the account email address.",
    subject: "Your password was changed",
    templateOwner: "@vs/mailer",
  },
  {
    kind: "welcome",
    trigger:
      "Optional product hook: send once after the account is considered active (for example immediately post-signup or immediately after email verification when that gate exists).",
    recipient: "Account holder at the account email address.",
    subject: "Welcome",
    templateOwner: "@vs/mailer",
  },
  {
    kind: "security_new_sign_in_notice",
    trigger:
      "Security path: notify when a sign-in is observed that the product classifies as notable (for example a new device or IP bucket). Dispatch only when backend policy enables it.",
    recipient: "Account holder at the account email address.",
    subject: "New sign-in to your account",
    templateOwner: "@vs/mailer",
  },
  {
    kind: "onboarding_import_ready",
    trigger:
      "After a guided Last.fm onboarding import finishes and listen stats rollups are populated, the system notifies the account holder so they can return when processing is done.",
    recipient: "Account holder at the account email address.",
    subject: "Your listening archive is ready",
    templateOwner: "@vs/mailer",
  },
] as const;

export function inventoryRowForKind(
  kind: TransactionalEmailKind,
): TransactionalEmailInventoryRow {
  const row = TRANSACTIONAL_EMAIL_INVENTORY.find((r) => r.kind === kind);
  if (!row) {
    throw new Error(`[transactional] missing inventory row for kind ${kind}`);
  }
  return row;
}
