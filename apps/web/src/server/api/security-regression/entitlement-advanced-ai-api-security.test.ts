import { describe, expect, it } from "vitest";
import { hasAdvancedEntitlement, requireAdvancedEntitlement } from "@vs/domain";
import { userMayReadAiLayer1Outputs } from "@/server/ai-layer1-entitlement";

/**
 * OSS single-user build: Advanced listening insights are always unlocked.
 * Keeps the security-regression manifest slot without SaaS plan gates.
 */
describe("Security regression: Advanced entitlement (OSS unlocked)", () => {
  it("allows Core product_plan for hasAdvancedEntitlement", () => {
    expect(hasAdvancedEntitlement({ productPlan: "core" })).toBe(true);
  });

  it("requireAdvancedEntitlement always returns ok", () => {
    expect(requireAdvancedEntitlement({ productPlan: "core" })).toEqual({ ok: true });
  });

  it("userMayReadAiLayer1Outputs is always true", () => {
    expect(userMayReadAiLayer1Outputs("core")).toBe(true);
    expect(userMayReadAiLayer1Outputs("advanced")).toBe(true);
  });
});
