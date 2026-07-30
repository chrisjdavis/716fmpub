import { describe, expect, it } from "vitest";
import { buildPasswordRecoveryAbsoluteUrl } from "./password-recovery-url";

describe("buildPasswordRecoveryAbsoluteUrl", () => {
  it("builds an absolute URL on the configured public origin with an opaque token query param", () => {
    const u = buildPasswordRecoveryAbsoluteUrl("https://app.example.test", "abc_raw_1");
    expect(u).toBe("https://app.example.test/reset-password?token=abc_raw_1");
  });
});
