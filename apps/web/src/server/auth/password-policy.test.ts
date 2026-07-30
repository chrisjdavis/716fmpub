import { describe, expect, it } from "vitest";
import {
  PASSWORD_SIGNUP_MAX_LENGTH,
  PASSWORD_SIGNUP_MIN_LENGTH,
  signupPasswordValueSchema,
} from "./password-policy";

describe("password-policy", () => {
  it("documents minimum and maximum signup lengths", () => {
    expect(PASSWORD_SIGNUP_MIN_LENGTH).toBe(12);
    expect(PASSWORD_SIGNUP_MAX_LENGTH).toBe(256);
  });

  it("accepts a passphrase meeting length and diversity rules", () => {
    const out = signupPasswordValueSchema.safeParse("correct-horse-9");
    expect(out.success).toBe(true);
  });

  it("rejects passwords shorter than the minimum", () => {
    const out = signupPasswordValueSchema.safeParse("short-9-ch");
    expect(out.success).toBe(false);
  });

  it("rejects passwords longer than the maximum", () => {
    const out = signupPasswordValueSchema.safeParse("a".repeat(257));
    expect(out.success).toBe(false);
  });

  it("rejects a single repeated character", () => {
    const out = signupPasswordValueSchema.safeParse("a".repeat(20));
    expect(out.success).toBe(false);
  });
});
