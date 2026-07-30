# Security architecture — authentication and trust boundary

This note is the canonical description of how production auth works **in this repository today**. Implementation lives primarily under `apps/web` (Next.js App Router), `apps/worker`, `apps/realtime`, and `packages/env`.

**Product model (716FM):** open-source **single-user** self-host. One owner is created via **`/setup`** (`POST /api/auth/setup`). There is **no** public signup, admin console, or multi-tenant invite flow.

## Authentication model

- **Mechanism:** Email + password. New passwords are stored as **Argon2id** PHC strings (`$argon2id$…` in `users.password_hash`); **legacy scrypt** (`scrypt$v1$…`) hashes are still verified for existing rows (see `apps/web/src/server/auth/password.ts`). There is no OAuth/social login in the current MVP.
- **Proof of identity after login:** An **opaque session token** in an **HttpOnly** cookie (`vs_session`, constant `AUTH_SESSION_COOKIE_NAME` in `@vs/domain`). The browser never runs code that reads this cookie for API calls; the server reads it via `cookies()` in `getServerSession()`.
- **Server-side verification:** The raw token is **never stored**. A **SHA-256** hash is stored in `sessions.token_hash` and matched on each request (`validateSession` in `apps/web/src/server/auth/session.ts`). After lookup, the server enforces **absolute expiry** (`expires_at` vs the request’s validation clock) and **idle** policy (`last_seen_at` within `SESSION_POLICY.idleTimeoutMs` of that clock), then optionally **rotates** the stored hash on authenticated API traffic.
- **First-run setup:** `GET /api/auth/setup` bootstraps a CSRF cookie. `POST /api/auth/setup` requires CSRF double-submit + `application/json`, creates the **sole** owner via `insertSoleOwnerUser` (exclusive table lock), hashes the password **only after** an early `countUsers` gate, inserts a session row, and sets session + CSRF cookies. Further setup attempts return **`409`** `already_configured`.

## Session boundary

- **Issuance:** `createDbSession` in `apps/web/src/server/auth/session.ts` inserts `(user_id, token_hash, expires_at, last_seen_at, last_rotated_at)` and returns the raw token once. Login (`/api/auth/login`) and setup apply `applySessionCookie` from the same module — `httpOnly`, `sameSite: 'lax'`, `path: '/'`, **`maxAge`** aligned to the absolute session TTL, **`secure`** when `NODE_ENV === "production"` or the deploy tier is staging/production (`VS_DEPLOY_ENV` / inferred deploy).
- **HTTP JSON API — two layers (do not confuse them):**
  1. **Edge middleware** — `apps/web/src/middleware.ts` runs on the Next.js **Edge** runtime for a **broad path matcher** (see `middleware.ts` `config.matcher` — static assets are excluded). In **strict** deploy tiers (`staging` / `production` per `VS_DEPLOY_ENV` / inferred deploy), it **requires HTTPS** for non-`OPTIONS` traffic: **`GET`/`HEAD`** receive **`308`** redirects to `VS_PUBLIC_APP_ORIGIN` + path + query; other methods receive **`403`** JSON with `code: "insecure_transport"` when the effective scheme is not HTTPS. **`OPTIONS`** skips the strict HTTPS upgrade so CORS preflight is not blocked (cleartext `OPTIONS` may still reach the app; terminate TLS at the edge in real deployments). **HSTS** (`Strict-Transport-Security`) is attached to responses when the request is already HTTPS in strict tiers. For **`/api/*`** only, the middleware also applies **fixed-window rate limits** (see `middleware-rate-limit.ts`) and the **session cookie prefilter** `sessionCookieGateResponse` (`apps/web/src/server/api/api-edge-session-gate.ts`). The cookie prefilter checks **only** that a **non-blank** `vs_session` cookie is **present**; it does **not** hit Postgres and does **not** prove the token is valid, unexpired, or within the idle window. **`OPTIONS`** requests skip the session cookie gate. Pathnames that skip the prefilter are listed in **`PUBLIC_API_ROUTE_SEGMENTS`** / **`PUBLIC_API_PATHNAMES`** in `apps/web/src/server/api/public-api-paths.ts` (login, **setup**, logout, recovery, verify-email*), plus any path under **`/api/internal/`** (see `isInternalApiPathname` in `apps/web/src/server/api/internal-api-paths.ts` — handlers enforce Bearer `VS_INTERNAL_API_SECRET`, not the session cookie). Any new **session-based public** JSON route under `/api/*` must be added to `public-api-paths` or clients will receive **401** at the edge. **Forwarded headers:** `VS_TRUST_PROXY_HEADERS` must be `"true"` or `"false"` in strict tiers; when `"false"`, rate limiting does **not** use `x-forwarded-for` / `x-real-ip` / `cf-connecting-ip` for client identity (see `middleware-rate-limit.ts`). When `"true"`, only enable if your ingress **overwrites** untrusted forwarded headers before Node.
  2. **Route handler session proof** — JSON route handlers use `withApiSession` → `requireSession()` → `validateSession(pool, raw, "api")` in `session.ts`, then **Host / Origin binding** on **unsafe** HTTP methods in strict tiers (`rejectUnlessTrustedAuthTransport` via `withApiSession` in `require-session.ts`, comparing `Host` / optional `Origin` to `VS_PUBLIC_APP_ORIGIN`), then **CSRF proof** on unsafe HTTP methods via `cookieAuthCsrfProofOr403` (`apps/web/src/server/api/api-csrf-guard.ts`). **Public** credential routes **`POST /api/auth/login`**, **`POST /api/auth/setup`**, and **`POST /api/auth/logout`** call the same Host / Origin helper **before** body handling because they do not use `withApiSession`. Setup additionally requires CSRF double-submit on POST. Mismatched **Host** returns **`403`** with `code: "invalid_host"`; mismatched **Origin** (when present) returns **`403`** with `code: "invalid_origin"`. This is where **absent**, **unknown**, **expired**, and **idle-expired** sessions are rejected. **401** responses use one shared JSON body from `apps/web/src/server/api/api-auth-response.ts`: **`{ "error": "Authentication required", "code": "unauthenticated" }`** (stable contract for both the Edge prefilter and handler gates). Invalid CSRF returns **`403`** with **`code: "csrf_invalid"`** (`apps/web/src/server/api/api-csrf-response.ts`). API mode may rotate the opaque token on a fixed cadence and emit `Set-Cookie` on the JSON response after a successful validation.
- **Validation (non-API RSC):** Server code reads the cookie via `readSessionRawToken()` / `getServerSession()` → `validateSession(pool, raw, "rsc")` in `session.ts` for dashboard pages. That path is **not** covered by the Edge matcher above; HTML routes redirect to login when unauthenticated.
- **Termination:** `POST /api/auth/logout` reads the cookie, **deletes** the matching `sessions` row when present, and clears **both** the session cookie and the CSRF cookie (see **CSRF** below). When a non-blank session cookie is present, logout **requires** a valid CSRF double-submit proof; callers without proof receive **`403`** with `code: "csrf_invalid"`. Unauthenticated callers (no session cookie) still receive **`200`** and cleared cookies without CSRF.

## CSRF (browser cookie sessions)

- **Threat model:** Authenticated actions use the **HttpOnly** session cookie (`vs_session`). Cross-site request forgery attempts to trick a logged-in browser into issuing **unsafe** requests (typically `POST` / `PATCH` / `PUT` / `DELETE`) that carry that cookie automatically. First-boot **setup** is also CSRF-gated so a malicious page cannot claim an empty instance via a simple cross-site POST.
- **Strategy:** **Double-submit cookie** synchronized with the session cookie policy. A second cookie, **`vs_csrf`** (`AUTH_CSRF_COOKIE_NAME` in `@vs/domain`), is **not** HttpOnly so first-party JavaScript can read it and send the same value in the **`x-csrf-token`** request header (`API_CSRF_HEADER_NAME`). The server compares the header to the cookie with a **constant-time** equality check.
- **Cookie alignment:** `vs_csrf` uses the same **`path: '/'`**, **`sameSite: 'lax'`**, **`secure`** rules (production / strict deploy tiers), and **`maxAge`** (absolute session TTL) as `vs_session` issuance helpers.
- **Issuance:** **`GET /api/auth/setup`** and successful **`POST /api/auth/login`** / **`POST /api/auth/setup`** set **`vs_csrf`**. **Safe** authenticated **`GET`** responses from `withApiSession` **bootstrap** `vs_csrf` when it is missing.
- **JSON Content-Type:** `parseJsonBodyWithSchema` requires `Content-Type: application/json` (**`415`** `invalid_content_type` otherwise) so cross-site simple `text/plain` POSTs cannot skip CORS preflight while still parsing as JSON.
- **Enforcement:** `withApiSession` runs **`cookieAuthCsrfProofOr403`** before the route handler on **unsafe** methods. **Setup POST** checks CSRF independently. Missing or mismatched proof returns **`403`** `csrf_invalid`.
- **Client contract:** Dashboard **`fetch`** mutations use **`browserCsrfHeaderRecord()`** (may `GET /api/me`). Setup uses **`ensurePublicSetupCsrfCookieValue()`** (`GET /api/auth/setup`).

## Rate limiting (Edge)

- Fixed-window counters live in **`fixed-window-rate-limit.ts`** and are **per Node process**, not distributed across replicas. Multi-instance deploys multiply effective budgets; treat limits as best-effort abuse brakes, not a hard global quota.
- Bucket mapping: `middleware-rate-limit.ts` (auth, email_outbound, destructive including `DELETE /api/me` and listen-data purge, sensitive_post, internal). Env knobs: `packages/env/src/abuse-env-fields.ts`.

## Privileged operations (server-enforced)

| Area | Surface | Enforcement |
|------|---------|-------------|
| Profile / credentials metadata | `GET` / `PATCH` / `DELETE /api/me` | `requireSession` + CSRF on mutating methods; PATCH updates display name, Last.fm username, optional per-user Last.fm API key (encrypted at rest when `VS_SECRETS_ENCRYPTION_KEY` is set; API returns `hasLastfmApiKey` only). DELETE removes the account and re-opens setup. |
| Listen data destruction | `POST /api/me/listen-data` | `requireSession` + **CSRF** + typed confirmation phrase **and** a valid **step-up token**. |
| Step-up (password re-check) | `POST /api/me/step-up` | `requireSession` + **CSRF** + current password. |
| Imports | `GET` / `POST /api/imports`, … | `requireSession` + **CSRF** on `POST`. |
| Exports | `POST /api/export/listens`, … | `requireSession` + **CSRF** on `POST`; download needs session + delivery token. |
| Analytics / dashboard API | `GET /api/analytics/*`, fingerprint, realtime handshake | `requireSession`. |
| Public listening (opt-in) | `GET /api/public/analytics/{archive-listens,window-total,summary}` | Edge allowlist; handler requires sole owner + `listening_history_public`. No session. |
| Internal HTTP | `/api/internal/*` | Bearer `VS_INTERNAL_API_SECRET`; **`503`** when unset. |

**Background work:** Import/export/listen-sync/analytics jobs run in **`apps/worker`** (BullMQ) after the web API enqueues with a session-bound `userId`.

## API authentication matrix

**Unauthenticated at the Edge cookie prefilter (by design):**

- `GET`/`POST /api/auth/setup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/recovery/request` and `POST /api/auth/recovery/confirm`
- `POST /api/auth/verify-email` and `POST /api/auth/verify-email-change`
- `GET /api/public/analytics/archive-listens`, `GET /api/public/analytics/window-total`, `GET /api/public/analytics/summary` (only when the sole owner has enabled `listening_history_public`; otherwise handlers return **404**)

There is **no** `/api/auth/signup` or `/api/admin/*` in this edition.

**Authenticated — session required:** `/api/me*`, `/api/imports*`, `/api/export/*`, `/api/analytics/*`, onboarding routes.

**Public HTML (opt-in):** `/explore` and `/archive` render when `users.listening_history_public` is true for the sole owner. They reuse Explore/Archive UI without dashboard chrome (no imports, exports, settings, or fingerprint polling). When the flag is off, those pages show a soft “not published” state instead of redirecting to login.

**Internal-only — Bearer `VS_INTERNAL_API_SECRET`:** `/api/internal/*`.

## High-risk flows (explicit)

1. **Setup** — claim empty instance; CSRF + Content-Type + sole-owner lock.
2. **Login** — generic failure text; dummy hash on unknown email; prior sessions wiped on success.
3. **Logout** — CSRF when session present.
4. **Import / export** — session-scoped jobs; export completion failures mark the job failed even if the ZIP was written.
5. **Account delete** — `DELETE /api/me` (step-up + CSRF); re-opens `/setup`.
6. **Internal Bearer** — treat `VS_INTERNAL_API_SECRET` as highly privileged.

## Password recovery

- Request/confirm routes are public; confirm invalidates all sessions. Mailer is optional in OSS (`VS_EMAIL_ENABLED`).

## Realtime WebSocket (secondary boundary)

- **Token:** `GET /api/me/listen-realtime` returns a short-lived HMAC token when `REALTIME_JWT_SECRET` is set.
- **Bridge:** `apps/realtime` verifies the token on first auth message. Postgres `LISTEN listen_change` **reconnects** with backoff after errors. Fan-out is **coalesced** per user (~75 ms trailing / 400 ms max wait). DB triggers notify **once per statement per distinct `user_id`** (not per row).

## Secrets and configuration boundary

| Secret / sensitive value | Loaded from | Used by | Must not appear on |
|--------------------------|-------------|---------|---------------------|
| `DATABASE_URL` | Root `.env` | Web, worker, realtime, scripts | Client bundles |
| `REDIS_URL` | Same | Web, worker | Client bundles |
| `LASTFM_API_KEY` | Same | Worker shared fallback | Client bundles |
| `VS_SECRETS_ENCRYPTION_KEY` | Same | Encrypts `users.lastfm_api_key` at rest | Client bundles, logs |
| `VS_INTERNAL_API_SECRET` | Same | Internal Bearer routes | Client bundles |
| `REALTIME_JWT_SECRET` | Same | Realtime WS tokens | Client bundles |
| Per-user Last.fm API key | DB (`users.lastfm_api_key`) | Worker imports | API responses (only `hasLastfmApiKey`) |

Generate `VS_SECRETS_ENCRYPTION_KEY` with `openssl rand -base64 32` for any durable deploy. When unset, Last.fm keys remain plaintext (local single-user only).
