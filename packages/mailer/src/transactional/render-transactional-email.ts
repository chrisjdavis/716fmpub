import { escapeHtmlText } from "./escape.js";
import type { TransactionalEmailAppContext } from "./identity.js";
import {
  inventoryRowForKind,
  type TransactionalEmailKind,
} from "./inventory.js";
import { wrapTransactionalEmail } from "./layout.js";

export type RenderedTransactionalEmail = Readonly<{
  kind: TransactionalEmailKind;
  to: string;
  subject: string;
  text: string;
  html: string;
}>;

function subjectLine(ctx: TransactionalEmailAppContext, kind: TransactionalEmailKind): string {
  return `${ctx.appName} — ${inventoryRowForKind(kind).subject}`;
}

function ctaParagraphHtml(label: string, url: string): string {
  const safeUrl = escapeHtmlText(url);
  const safeLabel = escapeHtmlText(label);
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46;">
    <a href="${safeUrl}" style="display:inline-block;padding:12px 18px;background:#18181b;color:#fafafa;text-decoration:none;border-radius:6px;font-weight:600;">${safeLabel}</a>
  </p>
  <p style="margin:0;font-size:13px;line-height:1.6;color:#71717a;word-break:break-all;">If the button does not work, copy and paste this URL into your browser:<br><span style="color:#3f3f46;">${safeUrl}</span></p>`;
}

/**
 * Caller must supply an HTTPS URL to the verification endpoint (contract: `https:` only).
 */
export function renderSignupEmailVerificationEmail(
  ctx: TransactionalEmailAppContext,
  input: Readonly<{ to: string; verificationUrl: string }>,
): RenderedTransactionalEmail {
  const kind = "signup_email_verification" as const;
  const { html, text } = wrapTransactionalEmail(ctx, {
    headline: "Confirm your email address",
    innerText: `Confirm your email for ${ctx.appName} by opening this link:\n\n${input.verificationUrl}\n\nIf you did not create an account, you can ignore this message.`,
    innerHtml: `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46;">Confirm your email for <strong>${escapeHtmlText(ctx.appName)}</strong> using the button below.</p>
      ${ctaParagraphHtml("Confirm email", input.verificationUrl)}
      <p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#52525b;">If you did not create an account, you can ignore this message.</p>`,
  });
  return {
    kind,
    to: input.to,
    subject: subjectLine(ctx, kind),
    text,
    html,
  };
}

export function renderEmailChangeVerificationEmail(
  ctx: TransactionalEmailAppContext,
  input: Readonly<{ to: string; verificationUrl: string }>,
): RenderedTransactionalEmail {
  const kind = "email_change_verification" as const;
  const { html, text } = wrapTransactionalEmail(ctx, {
    headline: "Confirm your new email address",
    innerText: `Confirm the new email for your ${ctx.appName} account by opening this link:\n\n${input.verificationUrl}\n\nIf you did not request this change, you can ignore this message; your sign-in email will stay the same.`,
    innerHtml: `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46;">Confirm the new email for your <strong>${escapeHtmlText(ctx.appName)}</strong> account using the button below.</p>
      ${ctaParagraphHtml("Confirm new email", input.verificationUrl)}
      <p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#52525b;">If you did not request this change, you can ignore this message. Your sign-in email will stay the same until you complete this step.</p>`,
  });
  return {
    kind,
    to: input.to,
    subject: subjectLine(ctx, kind),
    text,
    html,
  };
}

/**
 * `attemptedAtIso` must be an RFC 3339 instant from server clocks (no client inference).
 */
export function renderEmailChangeAttemptNoticeEmail(
  ctx: TransactionalEmailAppContext,
  input: Readonly<{ to: string; attemptedAtIso: string; securitySettingsUrl: string }>,
): RenderedTransactionalEmail {
  const kind = "email_change_attempt_notice" as const;
  const { html, text } = wrapTransactionalEmail(ctx, {
    headline: "Email change started",
    innerText: `Someone with access to your ${ctx.appName} account password started a request to change the sign-in email address.\n\nTime (UTC): ${input.attemptedAtIso}\n\nIf you made this request, complete the confirmation link sent to the new address.\n\nIf you did not make this request, secure your account immediately:\n${input.securitySettingsUrl}`,
    innerHtml: `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3f3f46;">Someone with access to your <strong>${escapeHtmlText(ctx.appName)}</strong> account password started a request to change the sign-in email address.</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#52525b;">Time (UTC): <strong>${escapeHtmlText(input.attemptedAtIso)}</strong></p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#52525b;">If you made this request, complete the confirmation link sent to the new address. Your sign-in email does not change until that step succeeds.</p>
      <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#52525b;">If you did not make this request, secure your account using the link below.</p>
      ${ctaParagraphHtml("Open account security", input.securitySettingsUrl)}`,
  });
  return {
    kind,
    to: input.to,
    subject: subjectLine(ctx, kind),
    text,
    html,
  };
}

/**
 * Caller must supply an HTTPS recovery URL that includes the opaque recovery token (contract: `https:` only).
 */
export function renderPasswordResetEmail(
  ctx: TransactionalEmailAppContext,
  input: Readonly<{ to: string; recoveryUrl: string }>,
): RenderedTransactionalEmail {
  const kind = "password_reset" as const;
  const { html, text } = wrapTransactionalEmail(ctx, {
    headline: "Reset your password",
    innerText: `We received a request to reset the password for your ${ctx.appName} account.\n\nOpen this link to choose a new password (it expires soon):\n\n${input.recoveryUrl}\n\nIf you did not request a reset, you can ignore this message. Your password will stay the same.`,
    innerHtml: `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46;">We received a request to reset the password for your <strong>${escapeHtmlText(ctx.appName)}</strong> account.</p>
      ${ctaParagraphHtml("Choose a new password", input.recoveryUrl)}
      <p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#52525b;">If you did not request a password reset, you can ignore this message. Your password will stay the same.</p>`,
  });
  return {
    kind,
    to: input.to,
    subject: subjectLine(ctx, kind),
    text,
    html,
  };
}

/**
 * `changedAtIso` must be an RFC 3339 instant from server clocks (no client inference).
 */
export function renderPasswordChangedConfirmationEmail(
  ctx: TransactionalEmailAppContext,
  input: Readonly<{ to: string; changedAtIso: string }>,
): RenderedTransactionalEmail {
  const kind = "password_changed_confirmation" as const;
  const loginUrl = new URL("/login", `${ctx.publicOrigin}/`).toString();
  const { html, text } = wrapTransactionalEmail(ctx, {
    headline: "Your password was changed",
    innerText: `The password for your ${ctx.appName} account was changed.\n\nTime (UTC): ${input.changedAtIso}\n\nIf you made this change, no further action is needed.\n\nIf you did not make this change, reset your password immediately from:\n${loginUrl}`,
    innerHtml: `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3f3f46;">The password for your <strong>${escapeHtmlText(ctx.appName)}</strong> account was changed.</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#52525b;">Time (UTC): <strong>${escapeHtmlText(input.changedAtIso)}</strong></p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#52525b;">If you made this change, no further action is needed.</p>
      <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#52525b;">If you did not make this change, reset your password immediately using the sign-in page below.</p>
      ${ctaParagraphHtml("Open sign-in", loginUrl)}`,
  });
  return {
    kind,
    to: input.to,
    subject: subjectLine(ctx, kind),
    text,
    html,
  };
}

/**
 * Optional welcome path. `startUrl` should be an HTTPS deep link (contract: `https:` only).
 */
export function renderWelcomeEmail(
  ctx: TransactionalEmailAppContext,
  input: Readonly<{ to: string; startUrl: string }>,
): RenderedTransactionalEmail {
  const kind = "welcome" as const;
  const { html, text } = wrapTransactionalEmail(ctx, {
    headline: `Welcome to ${ctx.appName}`,
    innerText: `Your ${ctx.appName} account is ready.\n\nGet started here:\n${input.startUrl}`,
    innerHtml: `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46;">Your <strong>${escapeHtmlText(ctx.appName)}</strong> account is ready.</p>
      ${ctaParagraphHtml("Get started", input.startUrl)}`,
  });
  return {
    kind,
    to: input.to,
    subject: subjectLine(ctx, kind),
    text,
    html,
  };
}

export function renderOnboardingImportReadyEmail(
  ctx: TransactionalEmailAppContext,
  input: Readonly<{ to: string; dashboardUrl: string }>,
): RenderedTransactionalEmail {
  const kind = "onboarding_import_ready" as const;
  const { html, text } = wrapTransactionalEmail(ctx, {
    headline: "Your import finished",
    innerText: `Your Last.fm import and stats processing for ${ctx.appName} are complete.\n\nOpen your dashboard:\n${input.dashboardUrl}`,
    innerHtml: `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46;">Your Last.fm import and stats processing for <strong>${escapeHtmlText(ctx.appName)}</strong> are complete.</p>
      ${ctaParagraphHtml("Open dashboard", input.dashboardUrl)}
      <p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#52525b;">You can close the app while imports run; this message confirms everything is ready to explore.</p>`,
  });
  return {
    kind,
    to: input.to,
    subject: subjectLine(ctx, kind),
    text,
    html,
  };
}

/**
 * Security notice when backend policy flags a notable sign-in. Fields are opaque strings from the server;
 * omit optional lines when unknown (no guessing).
 */
export function renderSecurityNewSignInNoticeEmail(
  ctx: TransactionalEmailAppContext,
  input: Readonly<{
    to: string;
    observedAtIso: string;
    sessionLabel?: string;
    approximateLocation?: string;
    securitySettingsUrl: string;
  }>,
): RenderedTransactionalEmail {
  const kind = "security_new_sign_in_notice" as const;
  const lines: string[] = [
    `We noticed a sign-in to your ${ctx.appName} account.`,
    `Time (UTC): ${input.observedAtIso}`,
  ];
  if (input.sessionLabel !== undefined && input.sessionLabel.length > 0) {
    lines.push(`Session: ${input.sessionLabel}`);
  }
  if (input.approximateLocation !== undefined && input.approximateLocation.length > 0) {
    lines.push(`Approximate location: ${input.approximateLocation}`);
  }
  lines.push(
    "",
    "If this was you, you can ignore this message.",
    "",
    "If this was not you, secure your account from:",
    input.securitySettingsUrl,
  );
  const optionalHtml: string[] = [];
  if (input.sessionLabel !== undefined && input.sessionLabel.length > 0) {
    optionalHtml.push(
      `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#52525b;">Session: <strong>${escapeHtmlText(input.sessionLabel)}</strong></p>`,
    );
  }
  if (input.approximateLocation !== undefined && input.approximateLocation.length > 0) {
    optionalHtml.push(
      `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#52525b;">Approximate location: <strong>${escapeHtmlText(input.approximateLocation)}</strong></p>`,
    );
  }
  const { html, text } = wrapTransactionalEmail(ctx, {
    headline: "New sign-in to your account",
    innerText: lines.join("\n"),
    innerHtml: `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3f3f46;">We noticed a sign-in to your <strong>${escapeHtmlText(ctx.appName)}</strong> account.</p>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#52525b;">Time (UTC): <strong>${escapeHtmlText(input.observedAtIso)}</strong></p>
      ${optionalHtml.join("")}
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#52525b;">If this was you, you can ignore this message.</p>
      <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#52525b;">If this was not you, review your account security using the link below.</p>
      ${ctaParagraphHtml("Review account security", input.securitySettingsUrl)}`,
  });
  return {
    kind,
    to: input.to,
    subject: subjectLine(ctx, kind),
    text,
    html,
  };
}
