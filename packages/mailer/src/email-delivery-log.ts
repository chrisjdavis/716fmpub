import { redactForLogLine, summarizeThrowableForLog } from "@vs/sensitive";

const SCHEMA_VERSION = 1;

const MAILGUN_TRANSPORT_CODE = "mailgun_transport" as const;

export type EmailDeliveryLogLevel = "info" | "warn" | "error";

export type EmailDeliveryChannel =
  | "transactional"
  | "mailgun_outbound"
  | "outbound_capture"
  | "outbound_noop";

export type EmailDeliveryEvent =
  | "email_send_attempt"
  | "email_send_success"
  | "email_send_retry"
  | "email_send_failure";

export type EmailDeliveryLogEntry = Readonly<{
  level: EmailDeliveryLogLevel;
  event: EmailDeliveryEvent;
  channel: EmailDeliveryChannel;
  /** ISO-8601 timestamp when the send was initiated (attempt row shares this as `sendStartedAt`). */
  sendStartedAt: string;
  recipient: string;
  /** Present for transactional sends. */
  transactionalKind?: string;
  /** 1-based attempt index within this send operation. */
  attempt: number;
  outcome?: "success" | "failure" | "retry_scheduled";
  providerMessageId?: string;
  httpStatus?: number;
  responseHint?: string;
  /** Redacted, truncated; never includes Mailgun API key material. */
  failure?: Readonly<{ errorType: string; errorMessage: string }>;
  retryAfterMs?: number;
}>;

function emitLine(level: EmailDeliveryLogLevel, entry: EmailDeliveryLogEntry): void {
  const line = JSON.stringify({
    vs: { kind: "email_delivery", v: SCHEMA_VERSION },
    ts: new Date().toISOString(),
    component: "vs-mailer",
    ...entry,
  });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/** Structured, single-line JSON for operators (stderr / log pipelines). No secrets or full provider bodies. */
export function logEmailDelivery(entry: EmailDeliveryLogEntry): void {
  emitLine(entry.level, entry);
}

export function summarizeProviderThrowableForLog(err: unknown): {
  errorType: string;
  errorMessage: string;
  httpStatus?: number;
  responseHint?: string;
} {
  const base = summarizeThrowableForLog(err);
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: unknown }).code === MAILGUN_TRANSPORT_CODE &&
    "httpStatus" in err &&
    typeof (err as { httpStatus: unknown }).httpStatus === "number"
  ) {
    const hintRaw = (err as { responseHint?: unknown }).responseHint;
    return {
      errorType: base.errorType,
      errorMessage: base.message,
      httpStatus: (err as { httpStatus: number }).httpStatus,
      responseHint:
        typeof hintRaw === "string" && hintRaw.length > 0 ? redactForLogLine(hintRaw) : undefined,
    };
  }
  return { errorType: base.errorType, errorMessage: base.message };
}
