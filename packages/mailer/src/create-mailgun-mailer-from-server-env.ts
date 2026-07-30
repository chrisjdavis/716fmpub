import type { ServerEnv } from "@vs/env";
import { MailgunMailer } from "./mailgun-mailer.js";
import type { OutboundMailer } from "./mailgun-mailer.js";
import { CaptureOutboundMailer, NoopOutboundMailer } from "./simulated-outbound-mailer.js";

/**
 * Factory for the shared outbound mailer (Mailgun HTTP, capture buffer, or noop).
 * Returns null when `VS_EMAIL_ENABLED` is not true in validated server env.
 */
export function createMailgunMailerFromServerEnv(env: ServerEnv): OutboundMailer | null {
  if (!env.emailOutboundEnabled || env.emailTransport === undefined) {
    return null;
  }
  if (env.emailTransport === "mailgun") {
    if (env.mailgunOutbound === undefined) {
      return null;
    }
    return new MailgunMailer(env.mailgunOutbound);
  }
  if (env.emailTransport === "capture") {
    return new CaptureOutboundMailer();
  }
  return new NoopOutboundMailer();
}
