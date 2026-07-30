import { describe, expect, it } from "vitest";
import { sanitizeNextPath } from "./safe-next-path";

describe("sanitizeNextPath", () => {
  it("allows known in-app prefixes", () => {
    expect(sanitizeNextPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeNextPath("/dashboard/settings")).toBe("/dashboard/settings");
    expect(sanitizeNextPath("/onboarding")).toBe("/onboarding");
    expect(sanitizeNextPath("/explore")).toBe("/explore");
    expect(sanitizeNextPath("/archive?month=2024-01")).toBe("/archive?month=2024-01");
  });

  it("rejects open-redirect tricks", () => {
    expect(sanitizeNextPath("//evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("/\\evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("/\\\\evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("https://evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("/@evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("/%2f%2fevil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("/login")).toBe("/dashboard");
  });

  it("falls back for empty or whitespace", () => {
    expect(sanitizeNextPath(undefined)).toBe("/dashboard");
    expect(sanitizeNextPath("")).toBe("/dashboard");
    expect(sanitizeNextPath("   ")).toBe("/dashboard");
  });
});
