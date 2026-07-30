import { STEP_UP_PURPOSES } from "@vs/db";
import { describe, expect, it } from "vitest";
import {
  API_STEP_UP_PURPOSES,
  authLoginBodySchema,
  authLogoutBodySchema,
  authRecoveryConfirmBodySchema,
  authRecoveryRequestBodySchema,
  authSetupBodySchema,
  authVerifyEmailBodySchema,
  authVerifyEmailChangeBodySchema,
  exportListensPostBodySchema,
  meResendVerificationBodySchema,
  importsPostBodySchema,
  meStepUpBodySchema,
  purgeListenDataBodySchema,
} from "./auth-account-input-schemas";

describe("auth-account-input-schemas strict contracts", () => {
  it("API step-up purposes match the database registry", () => {
    expect([...API_STEP_UP_PURPOSES]).toEqual([...STEP_UP_PURPOSES]);
  });

  it("rejects unknown keys on login", () => {
    const out = authLoginBodySchema.safeParse({
      email: "a@b.co",
      password: "x",
      extra: true,
    });
    expect(out.success).toBe(false);
  });

  it("rejects unknown keys on setup", () => {
    const out = authSetupBodySchema.safeParse({
      email: "a@b.co",
      password: "valid-signup-pass-1",
      role: "admin",
    });
    expect(out.success).toBe(false);
  });

  it("rejects setup passwords below policy length", () => {
    const out = authSetupBodySchema.safeParse({
      email: "a@b.co",
      password: "only-eleven",
    });
    expect(out.success).toBe(false);
  });

  it("accepts setup passwords that satisfy the policy", () => {
    const out = authSetupBodySchema.safeParse({
      email: "a@b.co",
      password: "twelve-chars-9",
    });
    expect(out.success).toBe(true);
  });

  it("accepts optional bootstrapSecret on setup", () => {
    const out = authSetupBodySchema.safeParse({
      email: "a@b.co",
      password: "twelve-chars-9",
      bootstrapSecret: "local-dev-bootstrap-secret",
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.bootstrapSecret).toBe("local-dev-bootstrap-secret");
    }
  });

  it("accepts logout {}", () => {
    expect(authLogoutBodySchema.safeParse({}).success).toBe(true);
  });

  it("accepts resend-verification {}", () => {
    expect(meResendVerificationBodySchema.safeParse({}).success).toBe(true);
    expect(meResendVerificationBodySchema.safeParse({ note: "x" }).success).toBe(false);
  });

  it("rejects logout body with keys", () => {
    expect(authLogoutBodySchema.safeParse({ a: 1 }).success).toBe(false);
  });

  it("rejects unknown keys on export POST", () => {
    const out = exportListensPostBodySchema.safeParse({
      format: "json",
      include: "all",
    });
    expect(out.success).toBe(false);
  });

  it("rejects unknown keys on import POST", () => {
    const out = importsPostBodySchema.safeParse({
      label: "L",
      lastfmUsername: "u",
      extra: true,
    });
    expect(out.success).toBe(false);
  });

  it("rejects unknown keys on step-up", () => {
    expect(
      meStepUpBodySchema.safeParse({
        password: "x",
        purpose: "purge_listen_data",
        extra: 1,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown keys on purge", () => {
    expect(
      purgeListenDataBodySchema.safeParse({
        confirmPhrase: "DELETE",
        stepUpToken: "t".repeat(32),
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("accepts recovery request email", () => {
    expect(authRecoveryRequestBodySchema.safeParse({ email: "a@b.co" }).success).toBe(true);
  });

  it("rejects recovery confirm with short token", () => {
    expect(
      authRecoveryConfirmBodySchema.safeParse({
        token: "short",
        password: "twelve-chars-9",
      }).success,
    ).toBe(false);
  });

  it("accepts verify-email body", () => {
    expect(
      authVerifyEmailBodySchema.safeParse({ token: "v".repeat(32) }).success,
    ).toBe(true);
    expect(authVerifyEmailChangeBodySchema.safeParse({ token: "v".repeat(32) }).success).toBe(
      true,
    );
  });

  it("canonicalizes mixed-case login emails", () => {
    const padded = authLoginBodySchema.safeParse({
      email: "  User@Test.DEV  ",
      password: "x",
    });
    const plain = authLoginBodySchema.safeParse({
      email: "user@test.dev",
      password: "x",
    });
    expect(padded.success && plain.success).toBe(true);
    if (padded.success && plain.success) {
      expect(padded.data.email).toBe("user@test.dev");
      expect(padded.data.email).toBe(plain.data.email);
    }
  });

  it("canonicalizes mixed-case setup emails like login", () => {
    const out = authSetupBodySchema.safeParse({
      email: "  NEW@Test.DEV ",
      password: "twelve-chars-9",
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.email).toBe("new@test.dev");
    }
  });

  it("canonicalizes recovery request emails consistently with login", () => {
    const out = authRecoveryRequestBodySchema.safeParse({
      email: "Reset@TEST.dev",
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.email).toBe("reset@test.dev");
    }
  });

  it("rejects whitespace-only email strings after canonicalization", () => {
    const out = authLoginBodySchema.safeParse({
      email: "   ",
      password: "x",
    });
    expect(out.success).toBe(false);
  });
});
