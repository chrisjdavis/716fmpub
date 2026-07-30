import type { ProductPlan } from "@vs/domain";

/**
 * OSS single-user build: Advanced listening insights are always available.
 */
export function userMayReadAiLayer1Outputs(_productPlan: ProductPlan): boolean {
  return true;
}
