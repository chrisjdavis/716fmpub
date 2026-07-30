/**
 * Returns the canonical account email used for persistence and equality checks
 * (signup, login, recovery lookup, and unique constraint alignment).
 */
export function canonicalizeAccountEmail(email: string): string {
  return email.normalize("NFC").trim().toLowerCase();
}

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * Gmail treats `.` and `+tag` in the local part as ignorable for delivery, and `googlemail.com` as
 * an alias of `gmail.com`. Used so login/recovery can find the row when the typed address differs
 * from the stored string but refers to the same mailbox.
 *
 * Non‑Gmail addresses return {@link canonicalizeAccountEmail} unchanged.
 */
export function accountEmailIdentityKey(email: string): string {
  const c = canonicalizeAccountEmail(email);
  const at = c.lastIndexOf("@");
  if (at <= 0) {
    return c;
  }
  let local = c.slice(0, at);
  const domain = c.slice(at + 1).toLowerCase();
  if (!GMAIL_DOMAINS.has(domain)) {
    return c;
  }
  const plus = local.indexOf("+");
  if (plus >= 0) {
    local = local.slice(0, plus);
  }
  const collapsed = local.replaceAll(".", "");
  return `${collapsed}@gmail.com`;
}
