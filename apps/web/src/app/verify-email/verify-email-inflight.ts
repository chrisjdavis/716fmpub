/**
 * Deduplicates in-flight verify-email POSTs per token so React Strict Mode's
 * effect double-invocation in development does not consume a single-use token twice.
 */
const verifyEmailInflight = new Map<
  string,
  Promise<{ ok: boolean; status: number; json: unknown }>
>();

export function verifyEmailOnce(token: string): Promise<{
  ok: boolean;
  status: number;
  json: unknown;
}> {
  const existing = verifyEmailInflight.get(token);
  if (existing) {
    return existing;
  }
  const p = (async () => {
    const res = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const json: unknown = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  })().finally(() => {
    verifyEmailInflight.delete(token);
  });
  verifyEmailInflight.set(token, p);
  return p;
}
