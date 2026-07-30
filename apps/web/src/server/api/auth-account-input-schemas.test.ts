import { STEP_UP_PURPOSES } from "@vs/db";
import { describe, expect, it } from "vitest";
import {
  API_STEP_UP_PURPOSES,
  adminInviteCreateBodySchema,
  adminInviteListQuerySchema,
  adminInviteRevokeBodySchema,
  adminUserListQuerySchema,
  adminUserPatchBodySchema,
  authLoginBodySchema,
  authLogoutBodySchema,
  authRecoveryConfirmBodySchema,
  authRecoveryRequestBodySchema,
  authSignupBodySchema,
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

  const sampleInviteToken = "y".repeat(43);

  it("rejects unknown keys on signup", () => {
    const out = authSignupBodySchema.safeParse({
      email: "a@b.co",
      password: "valid-signup-pass-1",
      inviteToken: sampleInviteToken,
      role: "admin",
    });
    expect(out.success).toBe(false);
  });

  it("rejects signup passwords below policy length", () => {
    const out = authSignupBodySchema.safeParse({
      email: "a@b.co",
      password: "only-eleven",
      inviteToken: sampleInviteToken,
    });
    expect(out.success).toBe(false);
  });

  it("rejects signup invite tokens shorter than 32 characters", () => {
    const out = authSignupBodySchema.safeParse({
      email: "a@b.co",
      password: "twelve-chars-9",
      inviteToken: "x".repeat(31),
    });
    expect(out.success).toBe(false);
  });

  it("accepts signup passwords that satisfy the policy", () => {
    const out = authSignupBodySchema.safeParse({
      email: "a@b.co",
      password: "twelve-chars-9",
      inviteToken: sampleInviteToken,
    });
    expect(out.success).toBe(true);
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
      force: true,
    });
    expect(out.success).toBe(false);
  });

  it("rejects unknown keys on step-up POST", () => {
    const out = meStepUpBodySchema.safeParse({
      password: "x",
      purpose: "purge_listen_data",
      csrf: "nope",
    });
    expect(out.success).toBe(false);
  });

  it("rejects unknown keys on purge listen data POST", () => {
    const out = purgeListenDataBodySchema.safeParse({
      confirmPhrase: "DELETE ALL MY LISTEN AND IMPORT DATA",
      stepUpToken: "tok",
      debug: true,
    });
    expect(out.success).toBe(false);
  });

  it("rejects an oversized step-up token string before application logic", () => {
    const out = purgeListenDataBodySchema.safeParse({
      confirmPhrase: "DELETE ALL MY LISTEN AND IMPORT DATA",
      stepUpToken: "z".repeat(600),
    });
    expect(out.success).toBe(false);
  });

  it("rejects unknown keys on recovery request", () => {
    const out = authRecoveryRequestBodySchema.safeParse({
      email: "a@b.co",
      hint: "x",
    });
    expect(out.success).toBe(false);
  });

  it("rejects recovery confirm tokens shorter than 32 chars", () => {
    const out = authRecoveryConfirmBodySchema.safeParse({
      token: "x".repeat(31),
      password: "twelve-chars-9",
    });
    expect(out.success).toBe(false);
  });

  it("accepts recovery confirm with long opaque token and valid password", () => {
    const out = authRecoveryConfirmBodySchema.safeParse({
      token: `  ${"y".repeat(43)}  `,
      password: "twelve-chars-9",
    });
    expect(out.success).toBe(true);
  });

  it("rejects recovery confirm passwords below policy length", () => {
    const out = authRecoveryConfirmBodySchema.safeParse({
      token: "y".repeat(43),
      password: "only-eleven",
    });
    expect(out.success).toBe(false);
  });

  it("rejects recovery confirm passwords that lack two distinct characters", () => {
    const out = authRecoveryConfirmBodySchema.safeParse({
      token: "y".repeat(43),
      password: "a".repeat(12),
    });
    expect(out.success).toBe(false);
  });

  it("rejects unknown keys on verify-email POST", () => {
    const out = authVerifyEmailBodySchema.safeParse({
      token: "y".repeat(43),
      hint: "x",
    });
    expect(out.success).toBe(false);
  });

  it("accepts verify-email with trimmed opaque token", () => {
    const out = authVerifyEmailBodySchema.safeParse({
      token: `  ${"y".repeat(43)}  `,
    });
    expect(out.success).toBe(true);
  });

  it("accepts verify-email-change with the same token contract as signup verify-email", () => {
    const token = "y".repeat(43);
    const signupVerify = authVerifyEmailBodySchema.safeParse({ token });
    const changeVerify = authVerifyEmailChangeBodySchema.safeParse({ token });
    expect(signupVerify.success && changeVerify.success).toBe(true);
    if (signupVerify.success && changeVerify.success) {
      expect(signupVerify.data).toEqual(changeVerify.data);
    }
  });

  it("canonicalizes mixed-case and padded emails the same for login", () => {
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

  it("canonicalizes mixed-case signup emails like login", () => {
    const out = authSignupBodySchema.safeParse({
      email: "  NEW@Test.DEV ",
      password: "twelve-chars-9",
      inviteToken: sampleInviteToken,
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

  it("rejects admin invite create bodies with unknown keys or past expiresAt", () => {
    expect(
      adminInviteCreateBodySchema.safeParse({ maxUses: 1, extra: true }).success,
    ).toBe(false);
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(
      adminInviteCreateBodySchema.safeParse({ maxUses: 1, expiresAt: past }).success,
    ).toBe(false);
  });

  it("accepts admin invite create with a future expiresAt", () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const out = adminInviteCreateBodySchema.safeParse({
      maxUses: 2,
      expiresAt: future,
      lockedEmail: null,
    });
    expect(out.success).toBe(true);
  });

  it("coerces admin invite list query limit from strings", () => {
    const out = adminInviteListQuerySchema.safeParse({
      limit: "50",
      lifecycle: "active",
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.limit).toBe(50);
      expect(out.data.lifecycle).toBe("active");
    }
  });

  it("accepts empty admin invite revoke body", () => {
    expect(adminInviteRevokeBodySchema.safeParse({}).success).toBe(true);
  });

  it("admin user PATCH body accepts exactly one of accountRole, accountStatus, or productPlan", () => {
    expect(adminUserPatchBodySchema.safeParse({ accountRole: "user" }).success).toBe(true);
    expect(adminUserPatchBodySchema.safeParse({ accountStatus: "active" }).success).toBe(true);
    expect(adminUserPatchBodySchema.safeParse({ productPlan: "core" }).success).toBe(true);
    expect(adminUserPatchBodySchema.safeParse({ productPlan: "advanced" }).success).toBe(true);
    expect(adminUserPatchBodySchema.safeParse({}).success).toBe(false);
    expect(
      adminUserPatchBodySchema.safeParse({ accountRole: "user", accountStatus: "active" }).success,
    ).toBe(false);
    expect(
      adminUserPatchBodySchema.safeParse({ accountRole: "user", productPlan: "advanced" }).success,
    ).toBe(false);
    expect(
      adminUserPatchBodySchema.safeParse({
        accountRole: "user",
        accountStatus: "active",
        productPlan: "core",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid productPlan literals on admin user PATCH body", () => {
    expect(adminUserPatchBodySchema.safeParse({ productPlan: "enterprise" }).success).toBe(false);
  });

  it("accepts optional productPlan on admin user list query", () => {
    expect(adminUserListQuerySchema.safeParse({ productPlan: "core" }).success).toBe(true);
    expect(adminUserListQuerySchema.safeParse({ productPlan: "advanced", q: "a" }).success).toBe(
      true,
    );
  });

  it("rejects invalid productPlan on admin user list query", () => {
    expect(adminUserListQuerySchema.safeParse({ productPlan: "enterprise" }).success).toBe(false);
  });
});
