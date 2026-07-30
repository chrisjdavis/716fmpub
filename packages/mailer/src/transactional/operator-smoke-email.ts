import type { TransactionalEmailAppContext } from "./identity.js";
import { wrapTransactionalEmail } from "./layout.js";

/**
 * Operator-only message (not part of the account-system inventory). Uses the same layout shell as product mail.
 */
export function renderOperatorMailgunSmokeEmail(
  ctx: TransactionalEmailAppContext,
  input: Readonly<{ to: string }>,
): Readonly<{ to: string; subject: string; text: string; html: string }> {
  const { html, text } = wrapTransactionalEmail(ctx, {
    headline: "Mailgun connectivity check",
    innerHtml: `<p style="margin:0;font-size:15px;line-height:1.6;color:#3f3f46;">Automated smoke-test message from <code style="font-size:0.95em;">packages/mailer</code> <code style="font-size:0.95em;">smoke:mailgun</code>.</p>`,
    innerText: "Automated smoke-test message from packages/mailer smoke:mailgun.",
  });
  return {
    to: input.to,
    subject: `${ctx.appName} — Mailgun connectivity check`,
    text,
    html,
  };
}
