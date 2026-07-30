/**
 * Normalizes user- or import-sourced strings before they are embedded in JSON or React text.
 *
 * This package does not render HTML. Callers must still treat output as **plain text only**:
 * never pass the result to `dangerouslySetInnerHTML`, `eval`, script URLs, or similar sinks.
 *
 * Angle brackets and quotes are not stripped; HTML safety depends on rendering this output only
 * as plain text (for example React child text), never via raw HTML concatenation.
 *
 * Removes characters that are not safely representable in typical UI text:
 * - U+0000 (removed; Postgres / wire oddities)
 * - Other C0 controls except TAB / LF / CR (replaced with ASCII space)
 * - ASCII DEL
 * - Unicode bidi override marks (spoofing / UI confusion)
 */
/** C0 controls except TAB / LF / CR; NUL is handled separately so it is deleted, not spaced. */
const C0_EXCEPT_WHITESPACE_NO_NUL = /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const BIDI_SPOOF = /[\u202A-\u202E\u2066-\u2069]/g;

export function sanitizeUserFacingPlainText(input: string | null | undefined): string {
  const s = input ?? "";
  return s.replace(/\u0000/g, "").replace(C0_EXCEPT_WHITESPACE_NO_NUL, " ").replace(BIDI_SPOOF, "");
}
