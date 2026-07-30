/**
 * Validates template / dispatch variables before rendering or sending.
 * Failures are explicit and carry no secrets.
 */

const MAX_EMAIL_LOCAL = 64;
const MAX_EMAIL_DOMAIN = 255;
const MAX_URL_LENGTH = 4096;
const MAX_OPAQUE_LINE = 512;

export class TransactionalEmailValidationError extends Error {
  readonly code = "transactional_email_validation";

  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = "TransactionalEmailValidationError";
  }
}

function assertNonEmptyString(value: string, field: string): string {
  const t = value.trim();
  if (t.length === 0) {
    throw new TransactionalEmailValidationError(`${field} must be a non-empty string.`, field);
  }
  return t;
}

/**
 * Pragmatic single-address check; avoids claiming full RFC 5322 compliance.
 */
export function validateTransactionalRecipientEmail(to: string): string {
  const v = assertNonEmptyString(to, "to");
  if (v.length > MAX_EMAIL_LOCAL + 1 + MAX_EMAIL_DOMAIN) {
    throw new TransactionalEmailValidationError("to exceeds maximum allowed length.", "to");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    throw new TransactionalEmailValidationError("to must be a single valid-looking email address.", "to");
  }
  return v;
}

/** Hostnames where http:// is accepted (local dev); production links must use https://. */
const HTTP_ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function isHttpAllowedForLoopbackDev(parsed: URL): boolean {
  if (parsed.protocol !== "http:") {
    return false;
  }
  return HTTP_ALLOWED_HOSTNAMES.has(parsed.hostname.toLowerCase());
}

export function validateHttpsAbsoluteUrl(url: string, field: string): string {
  const v = assertNonEmptyString(url, field);
  if (v.length > MAX_URL_LENGTH) {
    throw new TransactionalEmailValidationError(`${field} exceeds maximum allowed length.`, field);
  }
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    throw new TransactionalEmailValidationError(`${field} must be an absolute URL.`, field);
  }
  if (parsed.protocol === "https:" || isHttpAllowedForLoopbackDev(parsed)) {
    return v;
  }
  throw new TransactionalEmailValidationError(`${field} must use the https scheme.`, field);
}

export function validateRfc3339Instant(value: string, field: string): string {
  const v = assertNonEmptyString(value, field);
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) {
    throw new TransactionalEmailValidationError(`${field} must be a parseable RFC 3339 / ISO 8601 instant.`, field);
  }
  return v;
}

export function validateOptionalOpaqueLine(value: string | undefined, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const v = assertNonEmptyString(value, field);
  if (v.length > MAX_OPAQUE_LINE) {
    throw new TransactionalEmailValidationError(`${field} exceeds maximum allowed length.`, field);
  }
  return v;
}
