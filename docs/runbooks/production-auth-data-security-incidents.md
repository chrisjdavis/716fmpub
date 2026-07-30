# Production incident response — authentication and data security

**Purpose:** Give on-call engineers and release owners a **single, ordered playbook** for authentication, session, export, and data-deletion incidents in production. Follow steps in sequence unless parallel work is explicitly called out.

**Canonical technical context:** [`docs/security-architecture.md`](../security-architecture.md) (trust boundaries, routes, secrets matrix). This runbook is **operational**; it does not redefine product contracts.

**Where this lives:** Repository path `docs/runbooks/production-auth-data-security-incidents.md`. Release owners complete a **readiness review** of this document as part of [`docs/pre-production-security-review-checklist.md`](../pre-production-security-review-checklist.md).

**Severity default:** Treat suspected **session theft**, **secret exposure**, **cross-tenant export access**, or **mass / unauthorized deletion** as **high** until investigation proves otherwise. Prefer **visible, explicit** operator actions over guessing attacker scope from partial telemetry.

---

## 0. Roles and communication (every incident)

| Role | Responsibility |
|------|----------------|
| **Incident lead** | Owns timeline, delegates, decides when to widen containment |
| **Comms** | Customer / exec updates; no speculation; cite verified facts only |
| **Engineering** | Executes containment, rotation, validation, recovery |

**Communication rules**

1. Open an internal war room (chat / call) and a **single tracking doc** (ticket or post-mortem draft) with timestamps.
2. **Do not** paste session tokens, step-up tokens, passwords, `DATABASE_URL`, `REDIS_URL`, Bearer secrets, or per-user Last.fm keys into tickets, screenshots, or public channels.
3. External messaging: describe **impact in plain language** (“we invalidated active sessions”) not exploit mechanics until post-incident review approves detail.

---

## 1. Shared phases (containment → validation → rotation → communication → recovery)

Use this as a **backbone**; scenario sections below add specifics.

### 1.1 Containment

- Identify **what is known** vs **hypothesis**; record evidence (log lines, request ids, `security_audit_events` if available — see §5).
- If attacker may still have **network or credential access**, **block further damage first** (revoke sessions, disable internal API, restrict export downloads — see scenario playbooks) before deep forensics.
- Preserve **immutable logs** (copy relevant time windows to a secure store) before retention expiry if legal / compliance requires it.

### 1.2 Validation

- Reproduce the **reported symptom** in a **non-production** mirror when possible; never replay stolen tokens in prod logs.
- Confirm **HTTP contracts** match expectations: `401` / `403` / `503` with stable `code` fields per `security-architecture.md` (do not infer “safe” from UI alone).
- For data questions, use **Postgres as source of truth** for job and session rows; correlate with app logs and edge access logs.

### 1.3 Rotation (when secrets or long-lived tokens are implicated)

- Rotate **in dependency order**: credentials that grant access to others first (e.g. database superuser before app role if both exposed).
- Apply new values in the **host secret manager**, redeploy or restart **all** processes that cache env (`web`, `worker`, `realtime`, one-off jobs).
- **Validate** with [Secret rotation validation (dry-run)](#4-secret-rotation-validation-dry-run) before declaring rotation complete.

### 1.4 Communication

- Notify security / leadership per org policy.
- If user data was accessed or altered, follow **legal / privacy** playbooks (not duplicated here).

### 1.5 Recovery

- Remove temporary blocks (e.g. maintenance page) only after validation.
- Schedule **post-incident review**: root cause, detection gap, whether checklist or runbook needs an update in-repo.

---

## 2. Scenario — Session compromise

**Indicators:** Impossible travel, unexpected account changes, reports of account takeover, suspicious `sessions` growth, correlated abuse from one user id, forensic evidence of cookie theft (XSS unlikely given HttpOnly; consider malware or physical access).

### Containment

1. **Invalidate sessions for affected user(s):** delete `sessions` rows for `user_id` in scope (support runbook / SQL with peer review). For **full tenant reset** when scope is unclear, plan a **global session flush** with product leadership — users re-authenticate.
2. Force **password reset** for affected accounts if attacker could have changed password (recovery flow or operator-assisted process per product policy).
3. If compromise vector is **still active** (e.g. stolen admin panel), block that path before re-enabling login.

### Validation

- Confirm new logins create **new** `sessions` rows; old cookies return **`401`** with `code: "unauthenticated"` on protected APIs.
- Spot-check **CSRF** and **Host / Origin** rejections still occur for mismatched origins in strict tier.

### Rotation

- Session compromise **without** DB or signing key leak may require **no env secret rotation**; still rotate if any **password**, **recovery**, or **step-up** material was exposed.
- If `REALTIME_JWT_SECRET` or internal Bearer was also exposed, follow [§4](#4-secret-rotation-validation-dry-run).

### Communication

- Tell affected users to sign out all devices (or state that you invalidated sessions) and review linked email for password resets.

### Recovery

- Monitor `security_audit_events` and auth failure rates; watch for repeat takeover attempts.

---

## 3. Scenario — Secret leakage

**Indicators:** Secret in git history, CI log, support ticket, public gist, client bundle, or error payload; Gitleaks failure; accidental paste in Slack.

### Containment

1. **Assume active exposure** until the secret is revoked at the **issuer** (Postgres user, Redis ACL, Last.fm API account, etc.).
2. **Redact** the message / artifact in internal systems; do **not** “fix” git history on a shared default branch without coordinated force-push policy — **rotate the credential** regardless of history rewrite.
3. Disable dependent features if needed: e.g. unset `VS_INTERNAL_API_SECRET` yields **`503`** `internal_api_disabled` on internal routes (explicit failure per architecture doc).

### Validation

- Confirm old secret **fails** against the provider (e.g. DB connect, Redis `PING`, internal `GET` with old Bearer returns `403` / `503` as documented).
- Run **`npm run db:validate`** after `DATABASE_URL` change (from repo root with updated `.env` or injected env).

### Rotation

- Follow the matrix in [§4](#4-secret-rotation-validation-dry-run). **Every** leaked secret gets a **new** value; never reissue the same bytes.

### Communication

- Internal: which systems were rotated, who must redeploy, ETA for green health checks.
- External: only if customer impact (e.g. mandatory password reset).

### Recovery

- Re-run smoke or staging parity checks; add Gitleaks / audit follow-up per [`README.md`](../../README.md) CI security section.

---

## 4. Secret rotation validation (dry-run)

**Goal:** After any production secret change, prove **new material works** and **old material does not**, without inventing health from a single probe.

| Secret / variable | Issuer / store | Processes to restart | Practical validation (staging or post-deploy) |
|-------------------|----------------|------------------------|-----------------------------------------------|
| `DATABASE_URL` | Postgres credentials | Web, worker, scripts using pool | `npm run db:validate`; smoke login + dashboard read |
| `REDIS_URL` | Redis ACL / password | Web, worker | `npm run inspect:bullmq-queues` exits 0; enqueue smoke if queues enabled |
| `LASTFM_API_KEY` | Last.fm account | Worker | Trigger test import; confirm no auth errors in worker logs |
| `REALTIME_JWT_SECRET` | Operator-generated | Web, `apps/realtime` | `GET /api/me/listen-realtime` returns enabled token; WS auth succeeds |
| `VS_INTERNAL_API_SECRET` | Operator-generated | Web | `GET /api/internal/security/audit-events` with **new** Bearer returns `200`; **old** Bearer returns `403` `internal_api_forbidden` |
| Per-user Last.fm API key | User settings / support | Worker (reads DB) | User-scoped import succeeds; API still exposes only `hasLastfmApiKey` |

**Tabletop (recommended each quarter):** In staging, rotate a **non-production** copy of one secret, restart dependents, run `npm run smoke:local` (or equivalent) against staging base URL, then document pass/fail in the release ticket.

---

## 5. Scenario — Suspicious export access

**Indicators:** Alerts on download volume, unexpected `export_jobs` rows, user reports of foreign filenames, internal pen-test finding, access from unusual ASN concurrent with job completion.

### Containment

1. **Read-only recon:** Query `export_jobs` for affected `user_id` / time window; confirm job ids in logs match Postgres (no client-supplied owner id — see architecture doc).
2. If **artifact theft** is suspected, **tighten** `EXPORT_ARTIFACTS_DIR` OS permissions, shorten `EXPORT_ARTIFACT_RETENTION_SEC` temporarily (with product approval), or **pause** worker export processing via operational controls (scale to zero worker export consumer **only** if your deployment supports it without stranding `running` rows — prefer invalidating specific jobs after DB review).
3. Use **`GET /api/internal/security/audit-events`** (Bearer `VS_INTERNAL_API_SECRET`) for operator-visible audit metadata when configured.

### Validation

- Confirm `GET …/download` handlers reject **wrong user** with deterministic `404` / `410` per product contract (never stream another user’s file).
- Verify **CSRF** on `POST /api/export/listens` still enforced.

### Rotation

- If **internal API** or **session signing material** is not implicated, env rotation may be unnecessary; rotate **`VS_INTERNAL_API_SECRET`** if audit endpoint or operator tooling was exposed.

### Communication

- Notify affected users if their exports were accessed; cite confirmed DB / log evidence only.

### Recovery

- Clear stale `running` exports per [`docs/runbooks/bullmq-pilot-runbook.md`](./bullmq-pilot-runbook.md) if containment left queues inconsistent.

---

## 6. Scenario — Unauthorized deletion attempts

**Indicators:** Spike in `POST /api/me/listen-data` failures or successes, unexpected listen count drops, audit events for purge actions, user reports.

### Containment

1. **Preserve evidence:** export relevant `security_audit_events` rows and app logs for the window.
2. If a **bug or bypass** is suspected, consider **temporarily disabling** the route via emergency deploy or WAF rule **only** if your platform can do so without broader outage — coordinate with incident lead.
3. If **credentials stolen**, combine with [§2](#2-scenario--session-compromise): invalidate sessions and force password reset.

### Validation

- Confirm **`POST /api/me/listen-data`** still requires valid **step-up token**, **CSRF**, and **confirmation phrase**; replay and expiry return explicit `code` values (`step_up_replayed`, `step_up_expired`, etc.).
- Distinguish **successful** purges (irreversible) from blocked attempts in audit + DB row counts.

### Rotation

- Rotate secrets if leak could have furnished **password** or **session** sufficient to obtain step-up tokens.

### Communication

- Affected users: factual statement of data removed vs blocked attempts.

### Recovery

- If accidental purge: **restore from backup** only per organizational backup policy (out of scope to document here — link your RPO/RTO runbook).

---

## 7. Quick reference

| Need | Action |
|------|--------|
| Trust model | [`docs/security-architecture.md`](../security-architecture.md) |
| Pre-prod gate | [`docs/pre-production-security-review-checklist.md`](../pre-production-security-review-checklist.md) |
| Queue / export worker recovery | [`docs/runbooks/bullmq-pilot-runbook.md`](./bullmq-pilot-runbook.md) |
| CI leak response | [`README.md`](../../README.md) § CI security scanning |
| Operator audit read | `GET /api/internal/security/audit-events` with Bearer `VS_INTERNAL_API_SECRET` |

---

## 8. Failure visibility (do not ship false confidence)

- Prefer **explicit HTTP codes and `code` fields** over inferred “all clear” from partial logs.
- When telemetry is **stale** or **missing**, state that in comms and continue investigation — do not fabricate timelines or blast radius.
- After incidents, update this runbook if reality diverged from the steps above so the next response is faster.
