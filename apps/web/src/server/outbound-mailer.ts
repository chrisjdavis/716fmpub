import { loadServerEnv } from "@vs/env";
import { createMailgunMailerFromServerEnv, type OutboundMailer } from "@vs/mailer";

let cachedOutboundMailer: OutboundMailer | null | undefined;

/**
 * Shared outbound email boundary for the Next.js server.
 * Product code must obtain a mailer here (or via `@vs/mailer` factories) and must not call Mailgun HTTP APIs directly.
 */
export function getWebOutboundMailer(): OutboundMailer | null {
  if (cachedOutboundMailer === undefined) {
    cachedOutboundMailer = createMailgunMailerFromServerEnv(loadServerEnv());
  }
  return cachedOutboundMailer;
}
