# Agent notes (716fmpub)

- This is the **open-source single-user** edition: one owner via `/setup`, no signup/admin/invites, all features unlocked.
- Prefer small, scoped changes; keep SQL migrations explicit under `packages/db/migrations/`.
- Run `npm test` from the repository root before handing off work that touches shared packages.
- Do not reintroduce SaaS surfaces (multi-user signup, beta invites, product-plan gates, admin console) unless explicitly requested.
