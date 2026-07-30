# Mailgun account email operational runbook (716FM)

**Purpose:** Diagnose and operate **Mailgun-backed** transactional email for **signup verification** and **password reset** (plus closely related inventory kinds such as `password_changed_confirmation`). This runbook is the canonical operator reference for provider setup, DNS, delivery troubleshooting, support handling, and outage posture.

**Where it lives:** Repository path `docs/runbooks/mailgun-account-email-runbook.md` (bookmark or mirror alongside other runbooks under `docs/runbooks/`).

**Related documentation**

- Environment contracts and transport defaults: [README.md](../../README.md) (Environment variables, Outbound email and Mailgun).
- Kind list, subjects, logging fields: [`docs/transactional-email-inventory.md`](../transactional-email-inventory.md).
- Mailgun HTTP and env parsing: `packages/env/src/schema.ts`, outbound factory `packages/mailer/src/create-mailgun-mailer-from-server-env.ts`.
- Account routes (for support correlation): `apps/web/src/app/api/auth/setup/route.ts`, `apps/web/src/app/api/auth/recovery/request/route.ts`, `apps/web/src/app/api/me/resend-verification/route.ts`.

**Ownership:** Engineering defines Mailgun configuration and `@vs/mailer` behavior; release owners verify this runbook before production per [`docs/pre-production-security-review-checklist.md`](../pre-production-security-review-checklist.md). Support follows the procedures below; escalations that need infra or secret changes go to the team that owns deployment and `loadServerEnv()` configuration.

---

## 1. Provider and sender setup (Mailgun)

### 1.1 Mailgun account and API key

1. In the Mailgun control panel, create or select the **sending domain** that matches `MAILGUN_DOMAIN` (see §2).
2. Create a **private API key** with permission to send on that domain. Map it to `MAILGUN_API_KEY` in your secret store (never commit keys; repository uses `.env.example` comments only).
3. Confirm **region**: set `MAILGUN_REGION=us` or `eu` so the process targets the correct API host (`https://api.mailgun.net` vs `https://api.eu.mailgun.net`). The resolved `messagesUrl` is derived in `packages/env/src/schema.ts`.

### 1.2 DNS and domain verification

1. In Mailgun, open the domain’s DNS setup wizard and add the **exact** records Mailgun shows (typically SPF, DKIM, and sometimes tracking CNAMEs depending on product settings).
2. Wait for Mailgun to report the domain as **verified** before relying on production deliverability. Unverified or misaligned DNS commonly produces deferred mail, spam placement, or hard failures visible as non-2xx Mailgun responses in application logs (see §3.1 and §4.2).
3. Keep the **sending subdomain** (for example `mg.example.com`) consistent with `MAILGUN_DOMAIN` and with the address used in `MAILGUN_FROM` (the envelope/from must be authorized for that domain in Mailgun).

### 1.3 Sender configuration (`MAILGUN_FROM`)

1. Set `MAILGUN_FROM` to a **validated** sender the domain is allowed to use (bare email or `"Display Name <addr@domain>"`). Schema validation rejects malformed values at startup (`refineMailgunFromAddress` in `@vs/env`).
2. Product copy and templates do **not** override the RFC5322 `From` for real Mailgun posts; `MAILGUN_FROM` is the source of truth for the provider path (see transactional inventory).

### 1.4 Application links inside email

Transactional templates build verification and recovery URLs from **`VS_PUBLIC_APP_ORIGIN`** (canonical public HTTPS origin). If origin is wrong, links in mail point at the wrong host even when Mailgun accepts the message. Confirm this value matches the user-facing deployment before testing end-to-end.

---

## 2. Environment variables (operator checklist)

| Variable | Role |
|----------|------|
| `VS_EMAIL_ENABLED` | Must be `"true"` for account email paths to obtain a real or simulated mailer via `getWebTransactionalMailer()`. |
| `VS_EMAIL_TRANSPORT` | `mailgun` (real provider), `capture` (logs + in-memory buffer, no HTTP), or `noop`. Staging/production with email enabled require real Mailgun per schema; development/test default to `capture` unless overridden. |
| `VS_EMAIL_ALLOW_UNSAFE_MAILGUN` | **Only** development/test: must be `"true"` to use `mailgun` transport outside strict tiers. **Forbidden** in staging/production (startup validation fails). |
| `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM` | Required together when transport is `mailgun`. Partial `MAILGUN_*` when email is disabled or transport is capture/noop follows the “all or nothing” rule documented in README and `@vs/env` tests. |
| `MAILGUN_REGION` | Optional; `us` (default) or `eu`. |
| `VS_PUBLIC_APP_ORIGIN` | Required for link-bearing transactional sends where the app issues tokens (verification/recovery URLs). |
| `VS_DEPLOY_ENV` / `NODE_ENV` | Drive strict-tier validation (see `packages/env/src/tier-matrix.ts`). |

**Smoke send (operator):** From the repository root, with the same `.env` as other Node processes, `npm run mailer:smoke` exercises the configured transport. Real HTTP to Mailgun occurs only when transport is `mailgun` and `MAILER_SMOKE_DISPATCH=true` (see `.env.example` comments for `MAILER_SMOKE_TO`).

---

## 3. Operational dashboards and log review

### 3.1 Application logs (primary)

Outbound email emits **single-line JSON** with:

- `component`: `"vs-mailer"`
- `vs.kind`: `"email_delivery"`

Filter in your log platform (or `jq` on captured stderr) for those fields.

**Events** (`event`):

| `event` | Meaning |
|---------|---------|
| `email_send_attempt` | Send started; includes `recipient`, `transactionalKind` when applicable, `sendStartedAt`, `attempt`. |
| `email_send_success` | Provider accepted; includes `providerMessageId` when Mailgun returned one. |
| `email_send_retry` | Transient failure; Mailgun transport will retry (`retryAfterMs` may be present). |
| `email_send_failure` | Final failure after retries, or non-retryable error; includes redacted `failure` (`errorType`, `errorMessage`), optional `httpStatus`, `responseHint` (no full provider bodies or secrets). |

**Correlation:** Use the same `sendStartedAt` across attempt, retry, success, and failure lines for one logical send. Mailgun paths also set `channel` to `mailgun_outbound`; `capture` / `noop` use `outbound_capture` / `outbound_noop`.

**Signup-specific:** The signup route may emit `component: "auth-signup"` lines for `signup_verification_email_skipped` / `signup_verification_email_failed` when verification mail is skipped or fails; pair these with `vs-mailer` rows using time window and `userId` from the auth-signup JSON.

### 3.2 Mailgun control panel

Use Mailgun’s **Sending → Domain → Logs** (wording may vary by Mailgun UI version) to confirm acceptance, delivery, bounces, and suppressions. Cross-reference `providerMessageId` from `email_send_success` when you need provider-side confirmation for a specific send.

### 3.3 No separate in-repo “email dashboard”

716FM does not ship a dedicated first-party email metrics UI. Treat **structured application logs** plus the **Mailgun dashboard** as the two authoritative views: logs for dispatch decisions and errors, Mailgun for recipient-provider outcomes and suppression lists.

---

## 4. Troubleshooting failed or missing delivery

### 4.1 Verify configuration before deep debugging

1. Process starts cleanly: `loadServerEnv()` must succeed (misconfigured email env fails fast at boot).
2. `VS_EMAIL_ENABLED=true` and effective `emailTransport` match the environment intent (`mailgun` in strict tiers when email is on).
3. `VS_PUBLIC_APP_ORIGIN` set and correct for link-bearing mail.
4. Mailgun domain verified and DNS current.

### 4.2 Read the failure class from logs

1. Search for `email_send_failure` with the user’s address in `recipient` or the relevant `transactionalKind` (`signup_email_verification`, `password_reset`, etc.).
2. If only `email_send_retry` appears, watch for a later success or failure for the same `sendStartedAt`.
3. Use `httpStatus` and `responseHint` for Mailgun contract issues (auth, bad domain, validation) without exposing secrets in tickets.

### 4.3 Common provider-side causes

- **Suppression / bounce lists** in Mailgun for the recipient.
- **Unverified domain** or rotated DNS not yet propagated.
- **Wrong region** (`MAILGUN_REGION`) so the API key does not match the domain’s region.
- **Spam filtering** at the recipient mailbox (have the user check spam and allowlist the `MAILGUN_FROM` domain).

### 4.4 Common application-side causes

- **`getWebTransactionalMailer()` returns null** (email disabled, missing Mailgun bundle, or missing public origin): signup returns `emailVerificationDispatch` with `skipped` reasons; recovery request still returns `{ ok: true }` but **no** mail is sent—see §6.
- **Throws after logging:** `TransactionalMailerService` surfaces transport errors to callers; routes log and may still return success to the client where product requires it—never assume delivery without a matching `email_send_success`.

---

## 5. Support procedures

### 5.1 “I did not receive the signup verification email”

1. Confirm the account exists and is unverified (support tooling / read-only DB per your policy).
2. In logs, find `transactionalKind: "signup_email_verification"` (or `signup_verification_email_*` from signup) for the approximate time of signup.
3. Outcomes:
   - **`email_send_success`:** Ask the user to check spam; check Mailgun logs and suppressions for that address.
   - **`email_send_failure`:** Classify using `failure` / `httpStatus`; fix configuration or provider issue; ask the user to use **resend** once fixed.
   - **Skipped / no mailer:** Response body on signup includes `emailVerificationDispatch` for skipped reasons; operators fix `VS_PUBLIC_APP_ORIGIN` or email env. For an existing session, the authenticated user may call **`POST /api/me/resend-verification`** (see route under `apps/web/src/app/api/me/resend-verification/route.ts`).
4. Do **not** promise delivery unless logs show `email_send_success` (or capture transport in non-prod where appropriate).

### 5.2 “Password reset never arrived”

1. **Do not infer** whether an account exists: `POST /api/auth/recovery/request` always returns `{ ok: true }` on valid input to prevent account enumeration.
2. In logs, search for `transactionalKind: "password_reset"` for the user’s email and timestamp. If there is **no** attempt line, likely causes include missing user, missing `VS_PUBLIC_APP_ORIGIN`, or null mailer (same skip conditions as code path before send).
3. If `email_send_failure` appears, follow §4; if `email_send_success`, treat as mailbox/provider delivery issue (Mailgun logs, spam).
4. If the user mistyped their email at signup, recovery cannot reach them—handle per product policy (account recovery outside this runbook).

### 5.3 Password reset complaints after the fact (security-sensitive)

If the user reports **unauthorized** reset mail or suspicious activity, pivot to session and account containment per [`docs/runbooks/production-auth-data-security-incidents.md`](./production-auth-data-security-incidents.md); this runbook covers **delivery and configuration**, not full incident response.

---

## 6. Explicit user-visible contracts (avoid false assurance)

- **Signup:** HTTP response can include `emailVerificationDispatch` with `sent`, `skipped` (with `reason`), or `failed`—use this when explaining whether the product attempted provider delivery.
- **Password reset request:** Response is always `{ ok: true }` for valid transport and JSON; **delivery is not represented in that JSON**. Support must use **logs** (`email_send_*`) to confirm whether a send was attempted and whether Mailgun accepted it.
- **Stale or unknown state:** If logs are missing or retention-expired, state that explicitly to the user and offer a **single** new recovery or verification attempt after configuration checks, rather than guessing past delivery.

---

## 7. Provider outage or degraded Mailgun

1. Check Mailgun’s public status page (`https://status.mailgun.com`) for widespread incidents.
2. During outages, new sends may log `email_send_retry` then `email_send_failure`, or fail fast depending on error class. Communicate to stakeholders that **password reset** may not arrive until Mailgun recovers; signup verification is similarly affected.
3. **Disabling email entirely** (`VS_EMAIL_ENABLED` not true) stops outbound attempts but **breaks** expected account flows that depend on mail; treat as a product decision, not a silent toggle. If you must operate in “signup allowed but mail down,” document the UX impact (skipped/failed dispatch, recovery always `ok` without mail) for support scripts.
4. After recovery from outage, re-run a controlled `npm run mailer:smoke` in staging before announcing “email is healthy.”

---

## 8. Release readiness (tie-in)

Before production, release owners complete the pre-production checklist, including **review of this runbook** (see checklist section 9 and release readiness sign-off). Changes to `@vs/env` email validation, Mailgun transport, or account routes should trigger an update to this file in the same change when behavior shifts.
