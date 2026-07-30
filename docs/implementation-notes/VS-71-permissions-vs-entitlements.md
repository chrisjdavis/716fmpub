# VS-71 — TASK 5.3: Permissions (`account_role`) vs product entitlements (`product_plan`)

716FM keeps **two independent axes** on `users`: who may operate staff surfaces versus which **billing tier** unlocks product capabilities. Future packs must not treat them as interchangeable.

## Operational access: `users.account_role`

- **Purpose:** In-app **staff / operator** privilege (`user` → `admin` → `owner`), persisted as `users.account_role`.
- **Defines:** Access to `/admin` HTML, `/api/admin/*` JSON, bootstrap CLIs that promote roles, and similar **operational** controls.
- **Does not define:** Core vs Advanced **customer** features, AI outputs, or analytics bundles tied to the paid plan.

Canonical types and ordering live in `@vs/domain`:

- `ACCOUNT_ROLES`, `AccountRole`, `isAccountRole`, `accountRoleAtLeast` — `packages/domain/src/accountRole.ts`.

## Product access: `users.product_plan`

- **Purpose:** **716FM billing / subscription tier** (`core` | `advanced`), persisted as `users.product_plan`.
- **Defines:** Entitlement to **Advanced-only** product surfaces (listening insights, Layer 1–backed narrative and bundle reads, and onward for AI features scoped to Advanced in each ticket).
- **Does not grant:** Admin console access. A customer on **Advanced** with `account_role = 'user'` is still a normal end user.

Canonical types and ordering live in `@vs/domain`:

- `PRODUCT_PLANS`, `ProductPlan`, `isProductPlan`, `parseProductPlan`, `productPlanAtLeast` — `packages/domain/src/productPlan.ts`.

## Non-negotiable separation

| Question | Source of truth |
| --- | --- |
| “May this identity use `/admin` or staff APIs?” | `account_role` (plus session rules such as verified email — see `isEligibleForAdminSurfaces`). |
| “May this identity call Advanced-gated analytics / AI-backed reads?” | `product_plan` via entitlement helpers (below). |

**Staff `admin` / `owner` is not a substitute for Advanced.** An operator account can remain on **Core** while retaining admin powers; conversely, a paying **Advanced** subscriber has **no** admin/staff powers unless `account_role` is elevated through controlled processes (admin UI, migrations, bootstrap scripts).

**AI features from Layer 1 onward** (listening insights, dashboard summary that prefers `dashboard_bundle_v1`, home briefing / time machine loaders that gate on plan, and any future Layer 1+ AI routes) are **Advanced-only** in current contracts. See [VS-62](./VS-62-advanced-gated-listening-insights-read-contract.md), [VS-41](./VS-41-ai-layer-1-integration-boundaries.md), and `apps/web/src/server/ai-layer1-entitlement.ts` (`userMayReadAiLayer1Outputs`).

## Correct server-side checks (centralized helpers)

**Staff surfaces** — use `accountRoleAtLeast` (or the existing layout/API guards that wrap it):

```ts
import { accountRoleAtLeast } from "@vs/domain";

// Example: same rule as admin HTML eligibility (see admin-surface-eligibility.ts)
const mayUseStaffSurfaces =
  user.emailVerified && accountRoleAtLeast(user.accountRole, "admin");
```

**Advanced product entitlement** — use `hasAdvancedEntitlement` or `requireAdvancedEntitlement`; never infer Advanced from `account_role`:

```ts
import { hasAdvancedEntitlement, requireAdvancedEntitlement } from "@vs/domain";

// Boolean guard (e.g. RSC props, loaders)
const allowAiListeningInsights = hasAdvancedEntitlement({ productPlan: session.productPlan });

// API route: discriminated result → stable 403 contract
const advanced = requireAdvancedEntitlement({ productPlan: user.productPlan });
if (!advanced.ok) {
  return advancedEntitlementRequiredJsonResponse(); // apps/web/src/server/api/advanced-entitlement-json-response.ts
}
```

Thin product-facing wrappers (e.g. `userMayReadAiLayer1Outputs` in `apps/web/src/server/ai-layer1-entitlement.ts`) should **delegate** to `hasAdvancedEntitlement` so plan logic stays one-dimensional.

## Anti-patterns (do not ship)

- **Scattered string checks** such as `user.productPlan === "advanced"` or raw SQL comparing literals without going through `@vs/domain`. Plan literals and ordering can evolve; helpers encode the contract once.
- **Using `account_role === "admin"`** (or owner) to unlock AI, `dashboard_bundle_v1`, or other **Advanced** product paths — that confuses operator privilege with customer billing.
- **Client-only gating** for authoritative behavior: UI may hide buttons, but **every** API route and server loader that returns gated data must re-check entitlements on the server (existing routes use `withApiSession` + `requireAdvancedEntitlement`).

Prefer `parseProductPlan` / `isProductPlan` when ingesting untrusted strings; prefer `requireAdvancedEntitlement` in HTTP handlers so failure maps to the stable `advanced_entitlement_required` code (see VS-62 and `ADVANCED_ENTITLEMENT_REQUIRED_MESSAGE` in `@vs/domain`).

## Related implementation notes

- [VS-92 — Layer 1 automation lifecycle](./VS-92-task-9-1-layer1-automation-lifecycle.md) (enqueue gates on `product_plan`; admin routes still require `account_role` for staff access)
- [VS-62 — Advanced-gated listening insights read contract](./VS-62-advanced-gated-listening-insights-read-contract.md)
- [VS-41 — AI Layer 1 integration boundaries](./VS-41-ai-layer-1-integration-boundaries.md)
- [VS-22 — Auth user model audit](./VS-22-auth-user-model-audit.md) (historical; prefer this note for **role vs plan** semantics)
