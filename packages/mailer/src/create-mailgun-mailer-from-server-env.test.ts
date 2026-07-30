import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@vs/env";
import { createMailgunMailerFromServerEnv, CaptureOutboundMailer, MailgunMailer } from "./index.js";

describe("createMailgunMailerFromServerEnv", () => {
  it("returns null when outbound email is disabled", () => {
    const env = parseServerEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
      REDIS_URL: "redis://127.0.0.1:6379",
    });
    expect(createMailgunMailerFromServerEnv(env)).toBeNull();
  });

  it("returns CaptureOutboundMailer when VS_EMAIL_ENABLED defaults to capture in test", () => {
    const env = parseServerEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
      REDIS_URL: "redis://127.0.0.1:6379",
      VS_EMAIL_ENABLED: "true",
    });
    const mailer = createMailgunMailerFromServerEnv(env);
    expect(mailer).toBeInstanceOf(CaptureOutboundMailer);
  });

  it("returns MailgunMailer when transport is mailgun with explicit unsafe opt-in", () => {
    const env = parseServerEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
      REDIS_URL: "redis://127.0.0.1:6379",
      VS_EMAIL_ENABLED: "true",
      VS_EMAIL_TRANSPORT: "mailgun",
      VS_EMAIL_ALLOW_UNSAFE_MAILGUN: "true",
      MAILGUN_API_KEY: "k".repeat(32),
      MAILGUN_DOMAIN: "mg.example.com",
      MAILGUN_FROM: "noreply@mg.example.com",
    });
    const mailer = createMailgunMailerFromServerEnv(env);
    expect(mailer).toBeInstanceOf(MailgunMailer);
  });
});
