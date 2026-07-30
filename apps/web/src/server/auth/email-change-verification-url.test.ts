import { describe, expect, it } from "vitest";
import { buildEmailChangeVerificationAbsoluteUrl } from "./email-change-verification-url";

describe("buildEmailChangeVerificationAbsoluteUrl", () => {
  it("builds an absolute URL with token query", () => {
    const u = buildEmailChangeVerificationAbsoluteUrl("https://app.example.test", "abc_raw_1");
    expect(u).toBe("https://app.example.test/verify-email-change?token=abc_raw_1");
  });
});
