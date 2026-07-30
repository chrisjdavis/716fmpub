import { describe, expect, it } from "vitest";
import {
  csrfDoubleSubmitValidSync,
  isUnsafeHttpMethod,
  newCsrfToken,
} from "@/server/auth/csrf-cookie";

describe("csrfDoubleSubmitValidSync", () => {
  it("accepts equal trimmed values", () => {
    const t = newCsrfToken();
    expect(csrfDoubleSubmitValidSync(`  ${t}  `, t)).toBe(true);
  });

  it("rejects missing header", () => {
    const t = newCsrfToken();
    expect(csrfDoubleSubmitValidSync(undefined, t)).toBe(false);
  });

  it("rejects missing cookie", () => {
    const t = newCsrfToken();
    expect(csrfDoubleSubmitValidSync(t, undefined)).toBe(false);
  });

  it("rejects mismatch", () => {
    const a = newCsrfToken();
    const b = newCsrfToken();
    expect(csrfDoubleSubmitValidSync(a, b)).toBe(false);
  });
});

describe("isUnsafeHttpMethod", () => {
  it("treats common mutators as unsafe", () => {
    expect(isUnsafeHttpMethod("POST")).toBe(true);
    expect(isUnsafeHttpMethod("patch")).toBe(true);
    expect(isUnsafeHttpMethod("DELETE")).toBe(true);
  });

  it("treats GET as safe", () => {
    expect(isUnsafeHttpMethod("GET")).toBe(false);
    expect(isUnsafeHttpMethod("HEAD")).toBe(false);
  });
});
