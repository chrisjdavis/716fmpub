import { randomUUID } from "node:crypto";

import { logEmailDelivery } from "./email-delivery-log.js";
import type { MailgunSendResult, OutboundEmailMessage, OutboundMailer } from "./mailgun-mailer.js";

const CAPTURE_CAP = 50;
let captureRing: OutboundEmailMessage[] = [];

/** Clears the in-process capture buffer (tests / dev resets). */
export function clearCapturedOutboundEmails(): void {
  captureRing = [];
}

/** Last captured messages (newest last), capped for bounded memory. */
export function getCapturedOutboundEmails(): readonly OutboundEmailMessage[] {
  return captureRing;
}

export class CaptureOutboundMailer implements OutboundMailer {
  async sendEmail(message: OutboundEmailMessage): Promise<MailgunSendResult> {
    const sendStartedAt = new Date().toISOString();
    logEmailDelivery({
      level: "info",
      event: "email_send_attempt",
      channel: "outbound_capture",
      sendStartedAt,
      recipient: message.to,
      attempt: 1,
    });
    captureRing = [...captureRing.slice(-(CAPTURE_CAP - 1)), message];
    const providerMessageId = `capture:${sendStartedAt}:${randomUUID()}`;
    logEmailDelivery({
      level: "info",
      event: "email_send_success",
      channel: "outbound_capture",
      sendStartedAt,
      recipient: message.to,
      attempt: 1,
      outcome: "success",
      providerMessageId,
    });
    return { providerMessageId };
  }
}

export class NoopOutboundMailer implements OutboundMailer {
  async sendEmail(message: OutboundEmailMessage): Promise<MailgunSendResult> {
    const sendStartedAt = new Date().toISOString();
    logEmailDelivery({
      level: "info",
      event: "email_send_attempt",
      channel: "outbound_noop",
      sendStartedAt,
      recipient: message.to,
      attempt: 1,
    });
    const providerMessageId = `noop:${randomUUID()}`;
    logEmailDelivery({
      level: "info",
      event: "email_send_success",
      channel: "outbound_noop",
      sendStartedAt,
      recipient: message.to,
      attempt: 1,
      outcome: "success",
      providerMessageId,
    });
    return { providerMessageId };
  }
}
