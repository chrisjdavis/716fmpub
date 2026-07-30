# VS-22 — TASK 1.1: Authentication and user model audit

Implementation note for invite gating and future admin authorization. Source: current `main`-line tree (716FM web + `@vs/db`).

## Current authentication shape

- **Mechanism:** First-party email + password. No OAuth. Sessions are opaque tokens stored as an HttpOnly cookie (`AUTH_SESSION_COOKIE_NAME` from `@vs/domain`, serialized in `apps/web/src/server/auth/session.ts`). Postgres table `sessions` holds `token_hash`, `expires_at`, `last_seen_at`, and `last_rotated_at` (idle + absolute TTL and optional rotation enforced in `validateSession`).
- **Session payload:** `AuthenticatedUser` is `{ id, email, emailVerified }` only. `emailVerified` mirrors `users.email_verified_at` at validation time (server read, not client-inferred).
- **Login:** `POST /api/auth/login` (`apps/web/src/app/api/auth/login/route.ts`) looks up credentials via `findUserWithPasswordByEmail`, issues a new row in `sessions`, sets session + CSRF cookies.
- **Logout / recovery / verify-email:** Public JSON routes under `apps/web/src/app/api/auth/*` with explicit Zod bodies (`auth-account-input-schemas.ts`).

## User schema (relevant columns)

`users` began as `id`, `email`, `password_hash`, timestamps (`packages/db/migrations/1744560000000_initial-users-and-sessions.cjs`). Subsequent migrations add product fields (e.g. `email_verified_at`, Last.fm and profile fields, `onboarding_state` and related onboarding timestamps, `stats_timezone`, etc.). **There is no `role`, `is_admin`, or invite foreign key today.**

## Where accounts are created

1. **Primary production path:** `POST /api/auth/signup` → `insertUser` in `apps/web/src/server/auth/user-repository.ts` (`insert into users (email, password_hash)`), then `issueEmailVerificationToken`, `createDbSession`, verification email when configured. Same transaction invalidates prior sessions for the browser cookie if present.
2. **Coarse kill switch:** `FEATURE_FLAGS.signupsDisabled` (`packages/feature-flags`) returns `403` from signup and hides some marketing/footer signup links (`apps/web/src/app/signup/page.tsx`, `app-footer.tsx`, `legal-document-chrome.tsx`). This is global on/off, not per-invite.
3. **Non-HTTP / operator paths:** `apps/web/scripts/seed-local-test-account.ts` upserts a dev user by direct SQL; it refuses `production` and `staging` deploy envs. Database operators could always insert rows outside the app.

## Exactly where unrestricted account creation occurs today

Any caller who can reach **`POST /api/auth/signup`** with trusted transport (`rejectUnlessTrustedAuthTransport`) and valid JSON **and** `signupsDisabled === false` can create a user row and receive a session cookie (`201`). There is **no** invite token, domain allowlist, or admin approval in that path. The edge middleware explicitly allows this route without a pre-existing session cookie (`apps/web/src/server/api/public-api-paths.ts` → `sessionCookieGateResponse`).

## Route protection (how requests are gated)

- **Edge (`apps/web/src/middleware.ts`):** HTTPS / headers, `/api` rate limits, and a **session-cookie prefilter** for `/api/*` except public auth routes and `/api/internal/*` (internal uses Bearer secret in handlers, `internal-api-auth.ts`).
- **API handlers:** Non-public routes are expected to wrap in `withApiSession` (`apps/web/src/server/api/require-session.ts`), which validates the cookie against Postgres, enforces CSRF on unsafe methods, and may rotate the session. A repo contract test guards this pattern (`api-route-protection.contract.test.ts`).
- **RSC / pages:** Example: `apps/web/src/app/dashboard/layout.tsx` calls `getServerSession()` and `redirect("/login?…")` when unauthenticated. Authoritative checks remain server-side.

## Onboarding and “status” today

- **Email verification:** Unverified users are steered by dashboard shell lock (`apps/web/src/server/dashboard-shell-lock.ts`): locked until `email_verified_at` is set and onboarding completes.
- **Onboarding:** `users.onboarding_state` and related columns (`@vs/db` `onboardingState.ts`). `/onboarding` layout redirects to `/dashboard`; guided setup runs inside the dashboard shell while locked.

## Roles and admin authorization

Product auth **does not** expose application roles or admin flags in the session type or `users` table. `requireInternalApiAuth` gates **service-to-service** JSON under `/api/internal/*` with `VS_INTERNAL_API_SECRET`, which is unrelated to end-user admin RBAC.

## Reuse vs change for invite-only signup (minimal breakage)

**Reuse without redesign:** Session issuance, `validateSession`, `withApiSession`, CSRF + transport guards, login/logout/recovery, email verification flow, dashboard layout redirects, and `insertUser` transaction shape (single user insert + tokens + session).

**Minimum codepaths to touch for invite-only creation (conceptual):**

1. **`POST /api/auth/signup` handler** (`signup/route.ts`) — enforce a **server-validated** invite (new table or token column: single-use, expiry, email binding as required). Reject before `insertUser` with a stable 4xx + machine-readable code for UX and operators.
2. **`authSignupBodySchema`** (`auth-account-input-schemas.ts`) — add optional or required invite fields per chosen contract; keep unknown-key rejection behavior.
3. **Public UI** — `/signup` and any “Create account” entry points should align with backend rules (hide or collect invite token); keep `signupsDisabled` behavior coherent (global off vs invite-required).
4. **`PUBLIC_API_PATHNAMES`** — only if a new unauthenticated endpoint is introduced (e.g. invite validation preflight); otherwise unchanged.
5. **Tests** — extend `signup/route.test.ts` and schema tests for invite success/failure; avoid weakening transport or CSRF regressions.

Existing users and **`POST /api/auth/login`** need no change for invite gating if invites apply only to **new** `insertUser` calls.

## Admin authorization extension path

Add an explicit server-side source of truth (e.g. `users.role` enum or separate `user_roles` table), load it in `validateSession` or a dedicated helper, and gate admin routes/APIs with the same `withApiSession` pattern plus role checks. Do not infer admin from email patterns in production.

## Risks called out

- **Bypass:** Until signup validates invites, the API remains open whenever `signupsDisabled` is false.
- **Operational invites:** Internal scripts and DB access can still create users; document and restrict by environment if needed.
- **Backlog clarity:** Invite failures should return explicit error codes (failure-visibility) rather than generic 400s where operators need to triage.
