import { escapeHtmlText } from "./escape.js";
import type { TransactionalEmailAppContext } from "./identity.js";

function footerNote(ctx: TransactionalEmailAppContext): string {
  return `You received this message because of an action on your ${ctx.appName} account.`;
}

export type TransactionalLayoutBlock = Readonly<{
  /** Short line shown under the app name in HTML; plain-text title line. */
  headline: string;
  /** HTML fragment only (trusted template output; dynamic fragments must be escaped before calling). */
  innerHtml: string;
  /** Plain-text body (already safe for recipients). */
  innerText: string;
}>;

function textFooter(ctx: TransactionalEmailAppContext): string {
  const lines = [
    "—",
    ctx.appName,
    `${ctx.publicOrigin}/`,
    ctx.supportMailbox ? `Support: ${ctx.supportMailbox}` : undefined,
    footerNote(ctx),
  ].filter((l): l is string => l !== undefined);
  return `\n\n${lines.join("\n")}`;
}

function htmlFooter(ctx: TransactionalEmailAppContext): string {
  const support = ctx.supportMailbox
    ? `<p style="margin:12px 0 0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:13px;line-height:1.5;color:#52525b;">Support: <a href="mailto:${escapeHtmlText(ctx.supportMailbox)}" style="color:#18181b;">${escapeHtmlText(ctx.supportMailbox)}</a></p>`
    : "";
  return `
    <p style="margin:24px 0 0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:13px;line-height:1.5;color:#52525b;">${escapeHtmlText(footerNote(ctx))}</p>
    ${support}
    <p style="margin:16px 0 0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:12px;line-height:1.5;color:#a1a1aa;">${escapeHtmlText(ctx.publicOrigin)}</p>
  `;
}

/**
 * Wrap transactional content in a minimal, email-client-safe HTML shell and matching plain text.
 */
export function wrapTransactionalEmail(
  ctx: TransactionalEmailAppContext,
  block: TransactionalLayoutBlock,
): { html: string; text: string } {
  const text = `${ctx.appName}\n${block.headline}\n\n${block.innerText}${textFooter(ctx)}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtmlText(block.headline)}</title>
</head>
<body style="margin:0;background:#fafafa;color:#18181b;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#fafafa;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;padding:28px 24px;">
          <tr>
            <td style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:0.02em;color:#52525b;text-transform:uppercase;">${escapeHtmlText(ctx.appName)}</p>
              <h1 style="margin:0 0 20px;font-size:20px;line-height:1.3;font-weight:600;color:#18181b;">${escapeHtmlText(block.headline)}</h1>
              ${block.innerHtml}
              ${htmlFooter(ctx)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { html, text };
}
