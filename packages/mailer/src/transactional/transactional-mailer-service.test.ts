import { describe, expect, it, vi } from "vitest";
import {
  MailgunTransportError,
  type OutboundEmailMessage,
  type OutboundMailer,
} from "../mailgun-mailer.js";
import {
  TransactionalEmailDispatchError,
  TransactionalMailerService,
} from "./transactional-mailer-service.js";
import { TransactionalEmailValidationError } from "./validate-transactional-variables.js";

const sampleCtx = {
  appName: "716FM",
  publicOrigin: "https://app.example.test",
} as const;

function createCapturingOutbound(): { outbound: OutboundMailer; last: OutboundEmailMessage[] } {
  const last: OutboundEmailMessage[] = [];
  const outbound: OutboundMailer = {
    async sendEmail(message) {
      last.push(message);
      return { providerMessageId: "queued-test-id" };
    },
  };
  return { outbound, last };
}

describe("TransactionalMailerService", () => {
  it("validates signup verification URL before calling outbound sendEmail", async () => {
    const { outbound, last } = createCapturingOutbound();
    const svc = new TransactionalMailerService({ appContext: sampleCtx, outbound });
    await expect(
      svc.sendSignupEmailVerification({
        to: "user@example.test",
        verificationUrl: "http://evil.test/x",
      }),
    ).rejects.toBeInstanceOf(TransactionalEmailValidationError);
    expect(last).toHaveLength(0);
  });

  it("allows http signup verification URL for loopback dev hosts", async () => {
    const { outbound, last } = createCapturingOutbound();
    const svc = new TransactionalMailerService({ appContext: sampleCtx, outbound });
    await svc.sendSignupEmailVerification({
      to: "user@example.test",
      verificationUrl: "http://127.0.0.1:3456/verify-email?t=1",
    });
    expect(last).toHaveLength(1);
    expect(last[0]?.html).toContain("http://127.0.0.1:3456/verify-email?t=1");
  });

  it("constructs provider message from validated signup inputs", async () => {
    const { outbound, last } = createCapturingOutbound();
    const svc = new TransactionalMailerService({ appContext: sampleCtx, outbound });
    const result = await svc.sendSignupEmailVerification({
      to: "user@example.test",
      verificationUrl: "https://app.example.test/verify?t=1",
    });
    expect(result.kind).toBe("signup_email_verification");
    expect(result.providerMessageId).toBe("queued-test-id");
    expect(last).toHaveLength(1);
    const msg = last[0]!;
    expect(msg.to).toBe("user@example.test");
    expect(msg.subject).toContain("716FM");
    expect(msg.subject).toContain("Confirm your email");
    expect(msg.text.length).toBeGreaterThan(40);
    expect(msg.html).toContain("<!DOCTYPE html>");
    expect(msg.html).toContain("https://app.example.test/verify?t=1");
  });

  it("constructs provider message for email change verification", async () => {
    const { outbound, last } = createCapturingOutbound();
    const svc = new TransactionalMailerService({ appContext: sampleCtx, outbound });
    const result = await svc.sendEmailChangeVerification({
      to: "new@example.test",
      verificationUrl: "https://app.example.test/verify-email-change?t=1",
    });
    expect(result.kind).toBe("email_change_verification");
    expect(last[0]?.html).toContain("verify-email-change");
  });

  it("constructs provider message for email change attempt notice", async () => {
    const { outbound, last } = createCapturingOutbound();
    const svc = new TransactionalMailerService({ appContext: sampleCtx, outbound });
    const result = await svc.sendEmailChangeAttemptNotice({
      to: "old@example.test",
      attemptedAtIso: "2026-04-16T12:00:00.000Z",
      securitySettingsUrl: "https://app.example.test/dashboard/settings",
    });
    expect(result.kind).toBe("email_change_attempt_notice");
    expect(last[0]?.text).toContain("dashboard/settings");
  });

  it("rejects invalid changedAtIso for password changed confirmation", async () => {
    const { outbound, last } = createCapturingOutbound();
    const svc = new TransactionalMailerService({ appContext: sampleCtx, outbound });
    await expect(
      svc.sendPasswordChangedConfirmation({ to: "user@example.test", changedAtIso: "not-a-date" }),
    ).rejects.toBeInstanceOf(TransactionalEmailValidationError);
    expect(last).toHaveLength(0);
  });

  it("validates password reset recoveryUrl before calling outbound sendEmail", async () => {
    const { outbound, last } = createCapturingOutbound();
    const svc = new TransactionalMailerService({ appContext: sampleCtx, outbound });
    await expect(
      svc.sendPasswordReset({
        to: "user@example.test",
        recoveryUrl: "http://evil.test/reset",
      }),
    ).rejects.toBeInstanceOf(TransactionalEmailValidationError);
    expect(last).toHaveLength(0);
  });

  it("constructs provider message for password reset", async () => {
    const { outbound, last } = createCapturingOutbound();
    const svc = new TransactionalMailerService({ appContext: sampleCtx, outbound });
    const result = await svc.sendPasswordReset({
      to: "user@example.test",
      recoveryUrl: "https://app.example.test/reset-password?token=opaque",
    });
    expect(result.kind).toBe("password_reset");
    expect(last).toHaveLength(1);
    const msg = last[0]!;
    expect(msg.to).toBe("user@example.test");
    expect(msg.html).toContain("reset-password?token=opaque");
    expect(msg.text).toContain("reset-password?token=opaque");
  });

  it("constructs provider message for password changed confirmation with RFC3339 instant", async () => {
    const { outbound, last } = createCapturingOutbound();
    const svc = new TransactionalMailerService({ appContext: sampleCtx, outbound });
    const result = await svc.sendPasswordChangedConfirmation({
      to: "user@example.test",
      changedAtIso: "2026-04-16T12:00:00.000Z",
    });
    expect(result.kind).toBe("password_changed_confirmation");
    expect(last[0]?.subject.length).toBeGreaterThan(5);
    expect(last[0]?.text).toContain("2026");
  });

  it("emits structured vs-mailer logs for attempt and success", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { outbound } = createCapturingOutbound();
    const svc = new TransactionalMailerService({ appContext: sampleCtx, outbound });
    await svc.sendSignupEmailVerification({
      to: "user@example.test",
      verificationUrl: "https://app.example.test/verify?t=1",
    });
    const payloads = logSpy.mock.calls
      .map((c) => c[0])
      .filter((x): x is string => typeof x === "string")
      .map((line) => JSON.parse(line) as { component?: string; event?: string; transactionalKind?: string });
    expect(payloads.some((p) => p.component === "vs-mailer" && p.event === "email_send_attempt")).toBe(true);
    expect(payloads.some((p) => p.component === "vs-mailer" && p.event === "email_send_success")).toBe(true);
    expect(payloads.some((p) => p.transactionalKind === "signup_email_verification")).toBe(true);
    logSpy.mockRestore();
  });

  it("emits structured failure log before TransactionalEmailDispatchError", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const outbound: OutboundMailer = {
      sendEmail: vi.fn(async () => {
        throw new MailgunTransportError("down", 503, "try later");
      }),
    };
    const svc = new TransactionalMailerService({ appContext: sampleCtx, outbound });
    await expect(
      svc.sendWelcome({ to: "user@example.test", startUrl: "https://app.example.test/start" }),
    ).rejects.toBeInstanceOf(TransactionalEmailDispatchError);
    const failureLines = errSpy.mock.calls
      .map((c) => c[0])
      .filter((x): x is string => typeof x === "string")
      .map((line) => JSON.parse(line) as { event?: string; outcome?: string; httpStatus?: number });
    expect(failureLines.some((p) => p.event === "email_send_failure" && p.outcome === "failure")).toBe(true);
    expect(failureLines.some((p) => p.httpStatus === 503)).toBe(true);
    errSpy.mockRestore();
  });

  it("wraps outbound failures in TransactionalEmailDispatchError without exposing API keys", async () => {
    const outbound: OutboundMailer = {
      sendEmail: vi.fn(async () => {
        throw new Error(`internal upstream key=${"s".repeat(32)}`);
      }),
    };
    const svc = new TransactionalMailerService({ appContext: sampleCtx, outbound });
    const err = await svc
      .sendWelcome({ to: "user@example.test", startUrl: "https://app.example.test/start" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransactionalEmailDispatchError);
    expect((err as TransactionalEmailDispatchError).kind).toBe("welcome");
    expect(String(err)).not.toContain("s".repeat(32));
  });

  it("constructs provider message for onboarding import ready", async () => {
    const { outbound, last } = createCapturingOutbound();
    const svc = new TransactionalMailerService({ appContext: sampleCtx, outbound });
    const result = await svc.sendOnboardingImportReady({
      to: "user@example.test",
      dashboardUrl: "https://app.example.test/dashboard",
    });
    expect(result.kind).toBe("onboarding_import_ready");
    expect(last[0]?.subject).toContain("listening archive");
    expect(last[0]?.html).toContain("/dashboard");
  });
});
