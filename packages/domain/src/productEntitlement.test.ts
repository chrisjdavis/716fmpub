import { describe, expect, it } from "vitest";
import type { AccountRole } from "./accountRole.js";
import {
  ADVANCED_ENTITLEMENT_REQUIRED_MESSAGE,
  hasAdvancedEntitlement,
  requireAdvancedEntitlement,
} from "./productEntitlement.js";

describe("hasAdvancedEntitlement (OSS unlocked)", () => {
  it("allows Core", () => {
    expect(hasAdvancedEntitlement({ productPlan: "core" })).toBe(true);
  });

  it("allows Advanced", () => {
    expect(hasAdvancedEntitlement({ productPlan: "advanced" })).toBe(true);
  });

  it("allows regardless of account_role", () => {
    const ctx = { productPlan: "core" as const, accountRole: "user" as AccountRole };
    expect(hasAdvancedEntitlement(ctx)).toBe(true);
  });
});

describe("requireAdvancedEntitlement (OSS unlocked)", () => {
  it("returns ok: true for Core", () => {
    expect(requireAdvancedEntitlement({ productPlan: "core" })).toEqual({ ok: true });
  });

  it("returns ok: true for Advanced", () => {
    expect(requireAdvancedEntitlement({ productPlan: "advanced" })).toEqual({ ok: true });
  });
});

describe("ADVANCED_ENTITLEMENT_REQUIRED_MESSAGE", () => {
  it("is a non-empty stable string for safe client exposure", () => {
    expect(ADVANCED_ENTITLEMENT_REQUIRED_MESSAGE.length).toBeGreaterThan(0);
  });
});
