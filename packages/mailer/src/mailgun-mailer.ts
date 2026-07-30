import type { MailgunOutboundConfig } from "@vs/env";
import { redactForLogLine, summarizeThrowableForLog } from "@vs/sensitive";

import { logEmailDelivery } from "./email-delivery-log.js";

export type OutboundEmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type MailgunSendResult = {
  providerMessageId: string;
};

/** Provider HTTP failure; message is safe for logs/UI (no API key, no full response body). */
export class MailgunTransportError extends Error {
  readonly code = "mailgun_transport";

  constructor(
    message: string,
    readonly httpStatus: number,
    /** Short neutral hint for operators (never includes secrets). */
    readonly responseHint?: string,
  ) {
    super(message);
    this.name = "MailgunTransportError";
  }
}

export interface OutboundMailer {
  sendEmail(message: OutboundEmailMessage): Promise<MailgunSendResult>;
}

export type MailgunMailerTransportOptions = Readonly<{
  /**
   * Milliseconds to wait before each retry after a failed attempt.
   * Length determines retry count: `[]` disables retries; default `[250, 1000]` yields three POST attempts total.
   */
  retryBackoffMs?: readonly number[];
}>;

function redactMailgunErrorBody(raw: string, maxLen: number): string | undefined {
  const t = raw.trim();
  if (t.length === 0) {
    return undefined;
  }
  const slice = t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
  return slice.replace(/key=\S+/gi, "key=<redacted>");
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function isRetryableSendFailure(err: unknown): boolean {
  if (err instanceof MailgunTransportError) {
    return isRetryableHttpStatus(err.httpStatus);
  }
  if (err instanceof TypeError) {
    return true;
  }
  return false;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class MailgunMailer implements OutboundMailer {
  private readonly retryBackoffMs: readonly number[];

  constructor(
    private readonly config: MailgunOutboundConfig,
    options?: MailgunMailerTransportOptions,
  ) {
    this.retryBackoffMs = options?.retryBackoffMs ?? [250, 1_000];
  }

  async sendEmail(message: OutboundEmailMessage): Promise<MailgunSendResult> {
    const sendStartedAt = new Date().toISOString();
    const maxAttempts = 1 + this.retryBackoffMs.length;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      logEmailDelivery({
        level: "info",
        event: "email_send_attempt",
        channel: "mailgun_outbound",
        sendStartedAt,
        recipient: message.to,
        attempt,
      });
      try {
        const result = await this.postOnce(message);
        logEmailDelivery({
          level: "info",
          event: "email_send_success",
          channel: "mailgun_outbound",
          sendStartedAt,
          recipient: message.to,
          attempt,
          outcome: "success",
          providerMessageId: result.providerMessageId,
        });
        return result;
      } catch (err) {
        const canRetry = isRetryableSendFailure(err) && attempt < maxAttempts;
        if (canRetry) {
          const retryAfterMs = this.retryBackoffMs[attempt - 1] ?? 0;
          logEmailDelivery({
            level: "warn",
            event: "email_send_retry",
            channel: "mailgun_outbound",
            sendStartedAt,
            recipient: message.to,
            attempt,
            outcome: "retry_scheduled",
            retryAfterMs,
            failure: failureSummaryFromUnknown(err),
          });
          if (retryAfterMs > 0) {
            await sleepMs(retryAfterMs);
          }
          continue;
        }
        logEmailDelivery({
          level: "error",
          event: "email_send_failure",
          channel: "mailgun_outbound",
          sendStartedAt,
          recipient: message.to,
          attempt,
          outcome: "failure",
          failure: failureSummaryFromUnknown(err),
          ...(err instanceof MailgunTransportError
            ? {
                httpStatus: err.httpStatus,
                responseHint:
                  err.responseHint !== undefined && err.responseHint.length > 0
                    ? redactForLogLine(err.responseHint)
                    : undefined,
              }
            : {}),
        });
        throw err;
      }
    }
    throw new Error("[mailer] internal error: mailgun send loop exited unexpectedly.");
  }

  private async postOnce(message: OutboundEmailMessage): Promise<MailgunSendResult> {
    const form = new FormData();
    form.set("from", this.config.from);
    form.set("to", message.to);
    form.set("subject", message.subject);
    form.set("text", message.text);
    if (message.html !== undefined && message.html.length > 0) {
      form.set("html", message.html);
    }

    const auth = Buffer.from(`api:${this.config.apiKey}`, "utf8").toString("base64");
    const res = await fetch(this.config.messagesUrl, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}` },
      body: form,
    });

    const rawBody = await res.text();
    if (!res.ok) {
      const hint = redactMailgunErrorBody(rawBody, 200);
      throw new MailgunTransportError(
        `[mailer] Mailgun rejected the request (${res.status} ${res.statusText}).`,
        res.status,
        hint,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody) as { id?: unknown };
    } catch {
      throw new MailgunTransportError(
        "[mailer] Mailgun returned a non-JSON success body; treat this as a provider contract violation.",
        200,
      );
    }

    if (typeof parsed !== "object" || parsed === null || !("id" in parsed)) {
      throw new MailgunTransportError("[mailer] Mailgun success response missing id field.", 200);
    }

    const id = (parsed as { id: unknown }).id;
    if (typeof id !== "string" || id.length === 0) {
      throw new MailgunTransportError(
        "[mailer] Mailgun success response id must be a non-empty string.",
        200,
      );
    }

    return { providerMessageId: id };
  }
}

function failureSummaryFromUnknown(err: unknown): { errorType: string; errorMessage: string } {
  const s = summarizeThrowableForLog(err);
  return { errorType: s.errorType, errorMessage: s.message };
}
