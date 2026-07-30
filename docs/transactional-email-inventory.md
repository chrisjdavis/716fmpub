# Transactional email inventory (716FM)

**Operations:** For Mailgun setup, log review, support scripts, and outage handling, see [`docs/runbooks/mailgun-account-email-runbook.md`](./runbooks/mailgun-account-email-runbook.md).

Canonical kinds and contracts live in TypeScript: `TRANSACTIONAL_EMAIL_INVENTORY` and `TRANSACTIONAL_EMAIL_KINDS` in `packages/mailer/src/transactional/inventory.ts`. Renderers in `packages/mailer/src/transactional/render-transactional-email.ts` produce paired **HTML + plain text** using the shared layout in `packages/mailer/src/transactional/layout.ts`.

**Subject line convention:** product code uses `{{appName}} — {{base subject}}`, where `appName` matches the public product name and `base subject` is the stable phrase from the table below.

**Sender identity:** the RFC5322 `From` on real Mailgun posts comes from validated server env (`MAILGUN_FROM` when outbound transport is `mailgun`), not from templates. Templates own body copy and layout only. Development and test default to `capture` transport (logs plus an in-memory buffer; no Mailgun HTTP) unless you opt into `mailgun` with `VS_EMAIL_ALLOW_UNSAFE_MAILGUN=true`; staging and production always use `mailgun` when email is enabled.

| Kind | Trigger | Recipient | Base subject (after `appName —`) | Template owner |
| --- | --- | --- | --- | --- |
| `signup_email_verification` | User completes signup or verification request and the server issues an email-bound verification token. | Address being verified. | Confirm your email | `@vs/mailer` |
| `email_change_verification` | Authenticated user passes password step-up and requests an email change; server issues a token delivered only to the proposed new address. | Proposed new account email. | Confirm your new email | `@vs/mailer` |
| `email_change_attempt_notice` | After step-up for email change, server notifies the prior account email that a change was started (verification still goes to the new address). | Prior account email on file. | Email change started | `@vs/mailer` |
| `password_reset` | User requests password recovery for an existing account and the server issues a fresh recovery token. | Account email. | Reset your password | `@vs/mailer` |
| `password_changed_confirmation` | Password change succeeds (recovery completion, authenticated settings change, or equivalent server path). | Account email. | Your password was changed | `@vs/mailer` |
| `welcome` | Optional: once the account is considered active (for example post-signup or post-verification when that gate exists). | Account email. | Welcome | `@vs/mailer` |
| `security_new_sign_in_notice` | Security policy flags a notable sign-in (for example new device classification). | Account email. | New sign-in to your account | `@vs/mailer` |

**Operational smoke:** `packages/mailer/scripts/mailer-smoke.ts` uses `renderOperatorMailgunSmokeEmail`, which shares the same HTML/text shell but is **not** part of the account inventory above.

**Integration rule:** application features must call the `@vs/mailer` render helpers (or future wrappers that delegate to them) and pass `TransactionalEmailAppContext`; they must not assemble transactional subjects or bodies with ad hoc string templates.

## Diagnosing delivery failures (testing and production)

Outbound sends emit **single-line JSON** on stdout/stderr with `component:"vs-mailer"` and `vs.kind:"email_delivery"`. Filter with `jq` or your log stack using those fields.

| `event` | Meaning |
| --- | --- |
| `email_send_attempt` | A send started (Mailgun POST or transactional logical send). Includes `recipient`, `transactionalKind` when applicable, `sendStartedAt`, and `attempt`. |
| `email_send_success` | Provider accepted the message; includes `providerMessageId` (Mailgun message id). |
| `email_send_retry` | Mailgun transport is retrying after a **transient** failure (`5xx`, `429`, `425`, `408`, or a `TypeError` from `fetch`). See `retryAfterMs`. |
| `email_send_failure` | Final failure after retries (Mailgun) or immediate failure (non-retryable HTTP such as `401`/`400`, contract errors, or transactional dispatch). Includes redacted `failure` (`errorType`, `errorMessage`) and, when present, `httpStatus` and a short `responseHint` (never full provider bodies or API keys). |

**Correlate attempts:** transactional flows log the same `sendStartedAt` on attempt, success, and failure rows for one logical send. Mailgun HTTP paths use `channel:"mailgun_outbound"` and may log multiple `attempt` values when retries run. Simulated transports use `channel:"outbound_capture"` or `channel:"outbound_noop"` (no provider HTTP).

**Operator checklist:** confirm `VS_EMAIL_ENABLED`, resolved `emailTransport` from `loadServerEnv()` (`mailgun`, `capture`, or `noop`), production `MAILGUN_*` and `VS_PUBLIC_APP_ORIGIN` match the environment; verify Mailgun domain DNS and suppression lists when transport is `mailgun`; search logs for `email_send_failure` on the affected recipient or `transactionalKind`; cross-check `providerMessageId` from a success row in the Mailgun dashboard only for real provider sends (`mailgun` transport).

**API behavior:** `TransactionalMailerService` methods **throw** `TransactionalEmailDispatchError` on transport failure after logging; callers must not treat a thrown error as delivered mail. When outbound email is disabled or misconfigured, factories return `null` or omit the mailer — that is an explicit **skip**, not a silent success of a required send.
