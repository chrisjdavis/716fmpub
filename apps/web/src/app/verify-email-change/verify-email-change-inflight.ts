/**
 * Deduplicates in-flight verify-email-change POSTs per token so React Strict Mode's
 * effect double-invocation in development does not consume a single-use token twice.
 */
const inflight = new Map<string, Promise<{ ok: boolean; status: number; json: unknown }>>();

export function verifyEmailChangeOnce(token: string): Promise<{
  ok: boolean;
  status: number;
  json: unknown;
}> {
  const existing = inflight.get(token);
  if (existing) {
    return existing;
  }
  const p = (async () => {
    const res = await fetch("/api/auth/verify-email-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const json: unknown = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  })().finally(() => {
    inflight.delete(token);
  });
  inflight.set(token, p);
  return p;
}
