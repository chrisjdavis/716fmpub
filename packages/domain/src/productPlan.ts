/**
 * Customer-facing product subscription tier (716FM billing / entitlements).
 * Independent of staff privilege (`users.account_role`); do not conflate the two.
 */
export const PRODUCT_PLANS = ["core", "advanced"] as const;

export type ProductPlan = (typeof PRODUCT_PLANS)[number];

const PRODUCT_PLAN_ORDER: Record<ProductPlan, number> = {
  core: 0,
  advanced: 1,
};

export function isProductPlan(value: string): value is ProductPlan {
  return (PRODUCT_PLANS as readonly string[]).includes(value);
}

/**
 * Parse a loose string into a known plan, or `null` if unknown.
 * Prefer this over casting when the input is not already validated.
 */
export function parseProductPlan(value: string): ProductPlan | null {
  return isProductPlan(value) ? value : null;
}

/**
 * Entitlement ordering: `core` < `advanced`.
 * Returns true when `plan` includes every capability of `minimum` (same tier or higher).
 */
export function productPlanAtLeast(plan: ProductPlan, minimum: ProductPlan): boolean {
  return PRODUCT_PLAN_ORDER[plan] >= PRODUCT_PLAN_ORDER[minimum];
}
