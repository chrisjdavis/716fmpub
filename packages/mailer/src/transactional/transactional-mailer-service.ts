import type { MailgunSendResult, OutboundMailer } from "../mailgun-mailer.js";
import { logEmailDelivery, summarizeProviderThrowableForLog } from "../email-delivery-log.js";
import type { TransactionalEmailAppContext } from "./identity.js";
import type { TransactionalEmailKind } from "./inventory.js";
import {
  renderEmailChangeAttemptNoticeEmail,
  renderEmailChangeVerificationEmail,
  renderPasswordChangedConfirmationEmail,
  renderOnboardingImportReadyEmail,
  renderPasswordResetEmail,
  renderSecurityNewSignInNoticeEmail,
  renderSignupEmailVerificationEmail,
  renderWelcomeEmail,
} from "./render-transactional-email.js";
import {
  validateHttpsAbsoluteUrl,
  validateOptionalOpaqueLine,
  validateRfc3339Instant,
  validateTransactionalRecipientEmail,
} from "./validate-transactional-variables.js";

export type TransactionalMailerServiceConfig = Readonly<{
  appContext: TransactionalEmailAppContext;
  outbound: OutboundMailer;
}>;

export type TransactionalSendSuccess = Readonly<{
  kind: TransactionalEmailKind;
  providerMessageId: string;
}>;

export class TransactionalEmailDispatchError extends Error {
  readonly code = "transactional_email_dispatch";

  constructor(
    message: string,
    readonly kind: TransactionalEmailKind,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "TransactionalEmailDispatchError";
  }
}

/**
 * Typed entry points for inventory transactional emails. Validates variables,
 * renders HTML/text through shared templates, and delegates transport to {@link OutboundMailer}.
 */
export class TransactionalMailerService {
  constructor(private readonly cfg: TransactionalMailerServiceConfig) {}

  private async dispatch(
    kind: TransactionalEmailKind,
    recipient: string,
    send: () => Promise<MailgunSendResult>,
  ): Promise<TransactionalSendSuccess> {
    const sendStartedAt = new Date().toISOString();
    logEmailDelivery({
      level: "info",
      event: "email_send_attempt",
      channel: "transactional",
      sendStartedAt,
      recipient,
      transactionalKind: kind,
      attempt: 1,
    });
    try {
      const { providerMessageId } = await send();
      logEmailDelivery({
        level: "info",
        event: "email_send_success",
        channel: "transactional",
        sendStartedAt,
        recipient,
        transactionalKind: kind,
        attempt: 1,
        outcome: "success",
        providerMessageId,
      });
      return { kind, providerMessageId };
    } catch (err) {
      const detail = summarizeProviderThrowableForLog(err);
      logEmailDelivery({
        level: "error",
        event: "email_send_failure",
        channel: "transactional",
        sendStartedAt,
        recipient,
        transactionalKind: kind,
        attempt: 1,
        outcome: "failure",
        failure: { errorType: detail.errorType, errorMessage: detail.errorMessage },
        httpStatus: detail.httpStatus,
        responseHint: detail.responseHint,
      });
      throw new TransactionalEmailDispatchError(
        `[transactional] failed to send ${kind}; see cause for provider details.`,
        kind,
        err,
      );
    }
  }

  async sendSignupEmailVerification(input: Readonly<{ to: string; verificationUrl: string }>) {
    const to = validateTransactionalRecipientEmail(input.to);
    const verificationUrl = validateHttpsAbsoluteUrl(input.verificationUrl, "verificationUrl");
    const rendered = renderSignupEmailVerificationEmail(this.cfg.appContext, { to, verificationUrl });
    return this.dispatch(rendered.kind, to, () =>
      this.cfg.outbound.sendEmail({
        to: rendered.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      }),
    );
  }

  async sendEmailChangeVerification(input: Readonly<{ to: string; verificationUrl: string }>) {
    const to = validateTransactionalRecipientEmail(input.to);
    const verificationUrl = validateHttpsAbsoluteUrl(input.verificationUrl, "verificationUrl");
    const rendered = renderEmailChangeVerificationEmail(this.cfg.appContext, { to, verificationUrl });
    return this.dispatch(rendered.kind, to, () =>
      this.cfg.outbound.sendEmail({
        to: rendered.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      }),
    );
  }

  async sendEmailChangeAttemptNotice(
    input: Readonly<{
      to: string;
      attemptedAtIso: string;
      securitySettingsUrl: string;
    }>,
  ) {
    const to = validateTransactionalRecipientEmail(input.to);
    const attemptedAtIso = validateRfc3339Instant(input.attemptedAtIso, "attemptedAtIso");
    const securitySettingsUrl = validateHttpsAbsoluteUrl(
      input.securitySettingsUrl,
      "securitySettingsUrl",
    );
    const rendered = renderEmailChangeAttemptNoticeEmail(this.cfg.appContext, {
      to,
      attemptedAtIso,
      securitySettingsUrl,
    });
    return this.dispatch(rendered.kind, to, () =>
      this.cfg.outbound.sendEmail({
        to: rendered.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      }),
    );
  }

  async sendPasswordReset(input: Readonly<{ to: string; recoveryUrl: string }>) {
    const to = validateTransactionalRecipientEmail(input.to);
    const recoveryUrl = validateHttpsAbsoluteUrl(input.recoveryUrl, "recoveryUrl");
    const rendered = renderPasswordResetEmail(this.cfg.appContext, { to, recoveryUrl });
    return this.dispatch(rendered.kind, to, () =>
      this.cfg.outbound.sendEmail({
        to: rendered.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      }),
    );
  }

  async sendPasswordChangedConfirmation(input: Readonly<{ to: string; changedAtIso: string }>) {
    const to = validateTransactionalRecipientEmail(input.to);
    const changedAtIso = validateRfc3339Instant(input.changedAtIso, "changedAtIso");
    const rendered = renderPasswordChangedConfirmationEmail(this.cfg.appContext, { to, changedAtIso });
    return this.dispatch(rendered.kind, to, () =>
      this.cfg.outbound.sendEmail({
        to: rendered.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      }),
    );
  }

  async sendWelcome(input: Readonly<{ to: string; startUrl: string }>) {
    const to = validateTransactionalRecipientEmail(input.to);
    const startUrl = validateHttpsAbsoluteUrl(input.startUrl, "startUrl");
    const rendered = renderWelcomeEmail(this.cfg.appContext, { to, startUrl });
    return this.dispatch(rendered.kind, to, () =>
      this.cfg.outbound.sendEmail({
        to: rendered.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      }),
    );
  }

  async sendOnboardingImportReady(input: Readonly<{ to: string; dashboardUrl: string }>) {
    const to = validateTransactionalRecipientEmail(input.to);
    const dashboardUrl = validateHttpsAbsoluteUrl(input.dashboardUrl, "dashboardUrl");
    const rendered = renderOnboardingImportReadyEmail(this.cfg.appContext, { to, dashboardUrl });
    return this.dispatch(rendered.kind, to, () =>
      this.cfg.outbound.sendEmail({
        to: rendered.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      }),
    );
  }

  async sendSecurityNewSignInNotice(
    input: Readonly<{
      to: string;
      observedAtIso: string;
      sessionLabel?: string;
      approximateLocation?: string;
      securitySettingsUrl: string;
    }>,
  ) {
    const to = validateTransactionalRecipientEmail(input.to);
    const observedAtIso = validateRfc3339Instant(input.observedAtIso, "observedAtIso");
    const sessionLabel = validateOptionalOpaqueLine(input.sessionLabel, "sessionLabel");
    const approximateLocation = validateOptionalOpaqueLine(input.approximateLocation, "approximateLocation");
    const securitySettingsUrl = validateHttpsAbsoluteUrl(input.securitySettingsUrl, "securitySettingsUrl");
    const rendered = renderSecurityNewSignInNoticeEmail(this.cfg.appContext, {
      to,
      observedAtIso,
      sessionLabel,
      approximateLocation,
      securitySettingsUrl,
    });
    return this.dispatch(rendered.kind, to, () =>
      this.cfg.outbound.sendEmail({
        to: rendered.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      }),
    );
  }
}

export function createTransactionalMailerService(
  cfg: TransactionalMailerServiceConfig,
): TransactionalMailerService {
  return new TransactionalMailerService(cfg);
}
