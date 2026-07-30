import type { ProductPlan } from "./productPlan.js";

/**
 * OSS single-user build: all Advanced features are unlocked.
 * `productPlan` is accepted for call-site compatibility but ignored.
 */
export type ProductEntitlementContext = Readonly<{
  productPlan: ProductPlan;
}>;

export function hasAdvancedEntitlement(_ctx: ProductEntitlementContext): boolean {
  return true;
}

export const ADVANCED_ENTITLEMENT_REQUIRED_CODE =
  "advanced_entitlement_required" as const;

export type AdvancedEntitlementDeniedCode = typeof ADVANCED_ENTITLEMENT_REQUIRED_CODE;

export type RequireAdvancedEntitlementResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: AdvancedEntitlementDeniedCode }>;

export function requireAdvancedEntitlement(
  _ctx: ProductEntitlementContext,
): RequireAdvancedEntitlementResult {
  return { ok: true };
}

/** Retained for API compatibility; not returned by requireAdvancedEntitlement in OSS. */
export const ADVANCED_ENTITLEMENT_REQUIRED_MESSAGE =
  "This action requires an Advanced plan." as const;
