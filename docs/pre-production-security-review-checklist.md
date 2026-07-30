# Pre-production security review checklist

**Purpose:** Manual gate before **any** production deployment. It complements automated CI (lint, tests, Gitleaks, `npm audit`, env documentation checks in `.github/workflows/ci.yml`) by forcing a human pass over authentication, authorization, sensitive data flows, and operator-visible failure modes.

**Authority:** `docs/security-architecture.md` is the canonical technical description of the current trust model; this checklist references it but does not replace it.

**Incident operations:** `docs/runbooks/production-auth-data-security-incidents.md` is the canonical **production response** playbook for auth, session, export, and data-security incidents. On-call and release owners should bookmark the repository path (or your internal doc mirror) before carrying pager.

**Account email operations:** `docs/runbooks/mailgun-account-email-runbook.md` is the canonical runbook for Mailgun-backed signup verification, password reset, and related transactional delivery (DNS, env, logs, support, outages). Release owners bookmark it with the other runbooks under `docs/runbooks/`.

**Rule — no silent ship:** Production release is **blocked** until every **required** row in [Release readiness sign-off](#release-readiness-sign-off) is completed and **no Critical or High** finding remains open without an explicit, time-bounded exception recorded in [Residual risks](#residual-risks).

---

## How to use this document

1. Copy the [Findings log](#findings-log) template row for each issue discovered during review.
2. Walk each section below in order; mark items **Pass** / **Fail** / **N/A** with evidence (command, URL, log line, PR link).
3. **Fail** on any item that is a **Critical** or **High** risk must be remediated or escalated before sign-off (see [Severity](#severity-definitions)).
4. Record **Medium** and **Low** items: fix before release when practical; otherwise document under [Residual risks](#residual-risks) with owner and review date.
5. Complete [Release readiness sign-off](#release-readiness-sign-off) in the same change set as the deploy checklist run (or attach exported PDF/screenshot to your release ticket if your process stores artifacts elsewhere).

---

## Severity definitions

| Level | Meaning |
|-------|---------|
| **Critical** | Exploit likely: full account takeover, cross-tenant data access, secret exfiltration via product surface, or equivalent. **Must be resolved** before production. |
| **High** | Serious weakness: privilege bypass on a protected route, missing CSRF on state-changing session route, cleartext session cookies in production, secrets in client bundle, etc. **Must be resolved** before production. |
| **Medium** | Defense-in-depth gap, misconfiguration risk, or issue requiring privileged access to exploit. Document and schedule remediation. |
| **Low** | Hardening, documentation drift, or non-exploitable inconsistency. Track in backlog. |

---

## 1. Authentication

| # | Check | Result | Evidence / notes |
|---|--------|--------|-------------------|
| 1.1 | Session cookies are **HttpOnly**; `secure` is enforced in production / strict deploy tiers (`applySessionCookie` / `VS_DEPLOY_ENV`). | | |
| 1.2 | Session proof is **server-side** (hash in `sessions.token_hash`); raw token never stored. Absolute + idle expiry enforced in `validateSession`. | | |
| 1.3 | Login/signup failure responses do not leak whether an email exists (generic failure + constant-time password check path for unknown users). | | |
| 1.4 | Logout destroys the session row when a cookie is sent and clears session + CSRF cookies; CSRF required when session cookie present. | | |
| 1.5 | Passwords use Argon2id for new accounts; legacy scrypt verified only where documented (`password.ts`). | | |
| 1.6 | Strict-tier **HTTPS** enforcement and Host / Origin binding behave as documented for real production hostname (`middleware`, `rejectUnlessTrustedAuthTransport`). | | |

---

## 2. Authorization

| # | Check | Result | Evidence / notes |
|---|--------|--------|-------------------|
| 2.1 | Every new `/api/*` session route appears in the Edge public list **or** is correctly gated (cookie prefilter + `withApiSession` / `requireSession`). | | |
| 2.2 | **No** cross-tenant reads/writes: queries use `userId` from validated session (imports, exports, analytics, profile). | | |
| 2.3 | Internal routes under `/api/internal/` use Bearer `VS_INTERNAL_API_SECRET`; disabled state returns explicit `503` when secret unset. | | |
| 2.4 | Privileged destruction (`POST /api/me/listen-data`) requires step-up token + confirmation phrase; replay and expiry return explicit JSON codes. | | |
| 2.5 | Worker trust boundary documented: Redis/Postgres network isolation; no assumption that queue payloads are attacker-free without network controls. | | |

---

## 3. Data export

| # | Check | Result | Evidence / notes |
|---|--------|--------|-------------------|
| 3.1 | Export **POST** requires session + CSRF; job rows scoped by `userId`. | | |
| 3.2 | Status and download routes verify job belongs to session user before streaming artifact. | | |
| 3.3 | Artifact directory `EXPORT_ARTIFACTS_DIR` has correct OS permissions; retention (`EXPORT_ARTIFACT_RETENTION_SEC`) understood for prod. | | |
| 3.4 | Expired or invalid export access returns deterministic HTTP (e.g. 404/410 per product contract), not another user’s file. | | |

---

## 4. Data deletion

| # | Check | Result | Evidence / notes |
|---|--------|--------|-------------------|
| 4.1 | Listen-data purge is irreversible only after step-up + phrase; scope documented (listens/import/raw; **not** full account deletion unless product says otherwise). | | |
| 4.2 | No “soft delete” confusion: operators know whether `users` row deletion exists in product. | | |
| 4.3 | Related BullMQ / DB cleanup for stalled jobs understood (`README` operator sections). | | |

---

## 5. HTTP security headers and transport

| # | Check | Result | Evidence / notes |
|---|--------|--------|-------------------|
| 5.1 | Baseline headers (CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP) present on responses through Edge middleware (`browser-security-headers.ts`, `middleware.transport.ts`). | | |
| 5.2 | **HSTS** present on HTTPS responses in strict tiers when documented. | | |
| 5.3 | Production CSP `connect-src` includes realtime origin if WebSocket is used (`NEXT_PUBLIC_LISTEN_REALTIME_WS_URL` / related vars). | | |
| 5.4 | `VS_TRUST_PROXY_HEADERS` set intentionally; if `true`, ingress overwrites untrusted `X-Forwarded-*` / `CF-Connecting-IP`. | | |

---

## 6. Secrets and configuration

| # | Check | Result | Evidence / notes |
|---|--------|--------|-------------------|
| 6.1 | No server secrets in `NEXT_PUBLIC_*` or client bundles (grep / build artifact review). | | |
| 6.2 | `.env.example` lists all strict-tier security-critical variables required by `@vs/env` tests. | | |
| 6.3 | Production secrets live in host/secret manager — not in repo, not in logs. | | |
| 6.4 | `DATABASE_URL`, `REDIS_URL`, `LASTFM_API_KEY`, `REALTIME_JWT_SECRET`, `VS_INTERNAL_API_SECRET` access limited to processes that need them. | | |

---

## 7. Logging and observability

| # | Check | Result | Evidence / notes |
|---|--------|--------|-------------------|
| 7.1 | Logs do not print session tokens, step-up tokens, passwords, or per-user Last.fm API keys. | | |
| 7.2 | Auth failure modes emit stable `code` fields suitable for dashboards (no stack traces to clients in production). | | |
| 7.3 | Operators can distinguish **stale**, **disabled**, and **forbidden** states (`503` vs `403` vs `401` contracts). | | |

---

## 8. Rate limiting and abuse resistance

| # | Check | Result | Evidence / notes |
|---|--------|--------|-------------------|
| 8.1 | Edge fixed-window limits apply to `/api/*` as documented (`middleware-rate-limit.ts`); **OPTIONS** not blocked by limits inappropriately. | | |
| 8.2 | When `VS_TRUST_PROXY_HEADERS=false`, rate limit identity does not trust client-supplied forwarded headers. | | |
| 8.3 | Credential endpoints (`login`, `signup`) have appropriate throttling / lockout posture for your threat model (document if only rate limit). | | |

---

## 9. Incident response readiness

| # | Check | Result | Evidence / notes |
|---|--------|--------|-------------------|
| 9.1 | Release owner and on-call have **read** [`docs/runbooks/production-auth-data-security-incidents.md`](./runbooks/production-auth-data-security-incidents.md) for this release train (session compromise, secret leakage, suspicious export access, unauthorized deletion). | | |
| 9.2 | Team agrees **who** invokes global session invalidation vs per-user containment (SQL / tooling access documented for your environment). | | |
| 9.3 | **Secret rotation validation** path is understood: after prod secret changes, operators run the checks in runbook §4 (or staging equivalent) before closing the change ticket. | | |
| 9.4 | Release owner has **read** [`docs/runbooks/mailgun-account-email-runbook.md`](./runbooks/mailgun-account-email-runbook.md) when `VS_EMAIL_ENABLED=true` in the target environment (Mailgun setup, log review, support boundaries, outage posture for verification and password reset). | | |

---

## Findings log

| ID | Severity | Area | Description | Status | Owner |
|----|----------|------|-------------|--------|-------|
| | | | | Open / Fixed / Accepted | |

_Add rows as needed. **Critical** / **High** must be **Fixed** (not merely Accepted) before production unless Optimus-level exception with new evidence._

---

## Residual risks

Document **every** accepted risk that ships to production (including **Medium** issues deferred past release). If this section is empty, state: **“None identified for this release.”**

| Risk | Severity | Mitigation / compensating control | Revisit by |
|------|----------|-----------------------------------|------------|
| | | | |

---

## Release readiness sign-off

**Production deploy is not authorized** until all of the following are true:

- [ ] Sections **1–9** reviewed for this release (version / git SHA): ____________________
- [ ] [`docs/runbooks/production-auth-data-security-incidents.md`](./runbooks/production-auth-data-security-incidents.md) reviewed for operational readiness (§9 checklist).
- [ ] [`docs/runbooks/mailgun-account-email-runbook.md`](./runbooks/mailgun-account-email-runbook.md) reviewed when outbound account email is enabled (`VS_EMAIL_ENABLED=true`).
- [ ] CI security job green on the same SHA (or documented waiver with VP/Eng lead approval).
- [ ] **No open Critical or High** findings in [Findings log](#findings-log).
- [ ] [Residual risks](#residual-risks) completed (including explicit “none” statement).
- [ ] Staging or production-like smoke: `npm run smoke:local` equivalent against target environment **or** documented substitute with same API contracts exercised.

| Role | Name | Date (UTC) | Signature |
|------|------|------------|-----------|
| Reviewer (security / lead) | | | |
| Release owner | | | |

---

## Appendix — VS-61 repository-aligned baseline (static)

_The following reflects **design and code in this repository** as of the VS-61 task; it does **not** replace environment-specific verification above._

- **Auth / session / CSRF / Host-Origin:** Documented and implemented per `docs/security-architecture.md` (Argon2id + legacy scrypt, session hash storage, double-submit CSRF, strict HTTPS behavior).
- **Authorization matrix:** Route inventory table in `docs/security-architecture.md` matches middleware public paths and `withApiSession` patterns; internal API Bearer gate explicit.
- **Export / deletion:** High-risk flows enumerated in `docs/security-architecture.md` (export job user scoping, listen-data purge + step-up).
- **Headers:** CSP and companion headers implemented in `apps/web/src/server/http/browser-security-headers.ts` with tests in `browser-security-headers.test.ts` and middleware transport tests.
- **Secrets:** Table of secrets and “must not appear on” surfaces in `docs/security-architecture.md`; `@vs/env` strict-tier env doc tests in CI.
- **Logging:** Review handlers for accidental secret logging remains a **manual** per-release check (Section 7).
- **Rate limiting:** Implemented at Edge (`apps/web/src/server/api/middleware-rate-limit.ts`, `fixed-window-rate-limit.ts`); proxy trust behavior documented in security architecture.
- **Incident response:** Production playbook at `docs/runbooks/production-auth-data-security-incidents.md` (VS-63); Section 9 of this checklist ties release readiness to reviewing it.
- **Account email:** Mailgun operational runbook at `docs/runbooks/mailgun-account-email-runbook.md` (VS-105); Section 9 checklist item 9.4 ties release readiness to reviewing it when email is enabled.

**Residual baseline (inherent, not bugs):** Redis and Postgres must stay on private networks; forged BullMQ jobs are a trust-boundary concern if Redis is exposed. Realtime delegated JWT is narrow-purpose and requires `REALTIME_JWT_SECRET` where WS is enabled.
