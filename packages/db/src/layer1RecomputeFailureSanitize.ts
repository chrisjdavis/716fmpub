/**
 * VS-84 — normalize Layer 1 failure text for durable `layer1_user_recompute_state.failure_message`
 * and structured logs: staff-usable, bounded, without raw stack paths or multi-line dumps.
 */
const PATHISH =
  /(?:\/(?:Users|home|var|tmp|usr|opt|srv|mnt|dev|proc|root|workspace|src)\/[^\s:]{0,240}|(?:[A-Za-z]:\\[^\s:]{0,240}))/gi;

export function sanitizeLayer1RecomputeFailureMessageForPersistence(
  raw: string | null | undefined,
  failureCode: string,
): string | null {
  if (raw == null || raw.length === 0) {
    return null;
  }
  let s = raw.replace(/\r\n/g, "\n");
  const firstLine = s.split("\n")[0] ?? s;
  s = firstLine.replace(PATHISH, "<path>");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length === 0) {
    return `(${failureCode})`;
  }
  return s.length > 2000 ? `${s.slice(0, 1990)}…[truncated]` : s;
}
