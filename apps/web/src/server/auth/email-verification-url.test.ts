import { describe, expect, it } from "vitest";
import { buildEmailVerificationAbsoluteUrl } from "./email-verification-url";

describe("buildEmailVerificationAbsoluteUrl", () => {
  it("builds an absolute URL on the configured public origin with an opaque token query param", () => {
    const u = buildEmailVerificationAbsoluteUrl("https://app.example.test", "abc_raw_1");
    expect(u).toBe("https://app.example.test/verify-email?token=abc_raw_1");
  });
});
