import { describe, expect, it } from "vitest";
import { escapeHtmlText } from "./escape.js";
import {
  TRANSACTIONAL_EMAIL_INVENTORY,
  TRANSACTIONAL_EMAIL_KINDS,
  inventoryRowForKind,
} from "./inventory.js";
import { renderOperatorMailgunSmokeEmail } from "./operator-smoke-email.js";
import {
  renderEmailChangeAttemptNoticeEmail,
  renderEmailChangeVerificationEmail,
  renderPasswordChangedConfirmationEmail,
  renderPasswordResetEmail,
  renderSecurityNewSignInNoticeEmail,
  renderSignupEmailVerificationEmail,
  renderWelcomeEmail,
} from "./render-transactional-email.js";

const sampleCtx = {
  appName: "716FM",
  publicOrigin: "https://app.example.test",
} as const;

describe("transactional email inventory", () => {
  it("lists every kind exactly once", () => {
    const kinds = TRANSACTIONAL_EMAIL_INVENTORY.map((r) => r.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds.sort()).toEqual([...TRANSACTIONAL_EMAIL_KINDS].sort());
  });

  it("exposes stable template ownership", () => {
    for (const row of TRANSACTIONAL_EMAIL_INVENTORY) {
      expect(row.templateOwner).toBe("@vs/mailer");
    }
  });

  it("resolves rows by kind", () => {
    expect(inventoryRowForKind("password_reset").subject.length).toBeGreaterThan(0);
  });
});

describe("escapeHtmlText", () => {
  it("escapes HTML metacharacters", () => {
    expect(escapeHtmlText(`a<&>"'`)).toBe("a&lt;&amp;&gt;&quot;&#39;");
  });
});

describe("transactional renderers", () => {
  it("renders signup verification with html and text", () => {
    const out = renderSignupEmailVerificationEmail(sampleCtx, {
      to: "user@example.test",
      verificationUrl: "https://app.example.test/verify?token=abc",
    });
    expect(out.subject).toContain("716FM");
    expect(out.text).toContain("https://app.example.test/verify?token=abc");
    expect(out.html).toContain("https://app.example.test/verify?token=abc");
    expect(out.html).not.toContain("<script");
  });

  it("renders email change verification with html and text", () => {
    const out = renderEmailChangeVerificationEmail(sampleCtx, {
      to: "new@example.test",
      verificationUrl: "https://app.example.test/verify-email-change?token=abc",
    });
    expect(out.kind).toBe("email_change_verification");
    expect(out.text).toContain("verify-email-change?token=abc");
    expect(out.html).toContain("verify-email-change");
  });

  it("renders email change attempt notice with security link", () => {
    const out = renderEmailChangeAttemptNoticeEmail(sampleCtx, {
      to: "old@example.test",
      attemptedAtIso: "2026-04-16T12:00:00.000Z",
      securitySettingsUrl: "https://app.example.test/dashboard/settings",
    });
    expect(out.kind).toBe("email_change_attempt_notice");
    expect(out.text).toContain("dashboard/settings");
    expect(out.html).toContain("/dashboard/settings");
  });

  it("renders password reset with html and text", () => {
    const out = renderPasswordResetEmail(sampleCtx, {
      to: "user@example.test",
      recoveryUrl: "https://app.example.test/reset-password?token=xyz",
    });
    expect(out.text).toContain("/reset-password?token=xyz");
    expect(out.html).toContain("reset-password");
    expect(out.html).toContain("token=xyz");
  });

  it("renders password changed confirmation with login link", () => {
    const out = renderPasswordChangedConfirmationEmail(sampleCtx, {
      to: "user@example.test",
      changedAtIso: "2026-04-16T12:00:00.000Z",
    });
    expect(out.text).toContain("2026-04-16T12:00:00.000Z");
    expect(out.text).toContain("https://app.example.test/login");
    expect(out.html).toContain("/login");
  });

  it("renders welcome email", () => {
    const out = renderWelcomeEmail(sampleCtx, {
      to: "user@example.test",
      startUrl: "https://app.example.test/dashboard",
    });
    expect(out.text).toContain("https://app.example.test/dashboard");
    expect(out.html).toContain("dashboard");
  });

  it("omits optional security lines when unset", () => {
    const out = renderSecurityNewSignInNoticeEmail(sampleCtx, {
      to: "user@example.test",
      observedAtIso: "2026-04-16T12:00:00.000Z",
      securitySettingsUrl: "https://app.example.test/dashboard/settings",
    });
    expect(out.text).not.toContain("Session:");
    expect(out.html).not.toContain("Session:");
  });

  it("includes optional security context when provided", () => {
    const out = renderSecurityNewSignInNoticeEmail(sampleCtx, {
      to: "user@example.test",
      observedAtIso: "2026-04-16T12:00:00.000Z",
      sessionLabel: "Chrome on macOS",
      approximateLocation: "Toronto, CA",
      securitySettingsUrl: "https://app.example.test/dashboard/settings",
    });
    expect(out.text).toContain("Chrome on macOS");
    expect(out.text).toContain("Toronto, CA");
  });

  it("escapes injected markup in security session labels for html bodies", () => {
    const out = renderSecurityNewSignInNoticeEmail(sampleCtx, {
      to: "user@example.test",
      observedAtIso: "2026-04-16T12:00:00.000Z",
      sessionLabel: `"><script>alert(1)</script>`,
      securitySettingsUrl: "https://app.example.test/dashboard/settings",
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
  });
});

describe("operator smoke email", () => {
  it("returns multipart content for Mailgun", () => {
    const out = renderOperatorMailgunSmokeEmail(sampleCtx, { to: "ops@example.test" });
    expect(out.to).toBe("ops@example.test");
    expect(out.subject).toContain("Mailgun connectivity check");
    expect(out.text.length).toBeGreaterThan(20);
    expect(out.html).toContain("<!DOCTYPE html>");
  });
});
