import { loadServerEnv } from "@vs/env";
import { createTransactionalMailerService, type TransactionalMailerService } from "@vs/mailer";
import { getWebOutboundMailer } from "./outbound-mailer";

/**
 * Display name for transactional subjects and bodies. Kept aligned with product branding
 * (`docs/transactional-email-inventory.md`, Mailgun smoke script).
 */
const WEB_TRANSACTIONAL_APP_NAME = "716FM";

/**
 * Typed transactional mail boundary for account flows. Returns null when outbound email is
 * disabled or when `publicAppOrigin` is unset (links in templates require a canonical HTTPS origin).
 */
export function getWebTransactionalMailer(): TransactionalMailerService | null {
  const outbound = getWebOutboundMailer();
  if (!outbound) {
    return null;
  }
  const env = loadServerEnv();
  if (env.publicAppOrigin === undefined) {
    return null;
  }
  return createTransactionalMailerService({
    appContext: {
      appName: WEB_TRANSACTIONAL_APP_NAME,
      publicOrigin: env.publicAppOrigin,
    },
    outbound,
  });
}
