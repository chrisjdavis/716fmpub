import { describe, expect, it } from "vitest";
import {
  isProductPlan,
  parseProductPlan,
  productPlanAtLeast,
} from "./productPlan.js";

describe("isProductPlan", () => {
  it("accepts known tiers", () => {
    expect(isProductPlan("core")).toBe(true);
    expect(isProductPlan("advanced")).toBe(true);
  });

  it("rejects unknown strings", () => {
    expect(isProductPlan("enterprise")).toBe(false);
    expect(isProductPlan("admin")).toBe(false);
    expect(isProductPlan("")).toBe(false);
  });
});

describe("parseProductPlan", () => {
  it("returns the plan for valid literals", () => {
    expect(parseProductPlan("core")).toBe("core");
    expect(parseProductPlan("advanced")).toBe("advanced");
  });

  it("returns null for invalid input", () => {
    expect(parseProductPlan("pro")).toBeNull();
    expect(parseProductPlan("CORE")).toBeNull();
  });
});

describe("productPlanAtLeast", () => {
  it("orders core < advanced", () => {
    expect(productPlanAtLeast("core", "core")).toBe(true);
    expect(productPlanAtLeast("core", "advanced")).toBe(false);

    expect(productPlanAtLeast("advanced", "advanced")).toBe(true);
    expect(productPlanAtLeast("advanced", "core")).toBe(true);
  });
});
