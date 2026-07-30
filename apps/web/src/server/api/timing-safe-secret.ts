import { createHash, timingSafeEqual } from "node:crypto";

/** Timing-safe equality for UTF-8 secrets of unequal length (via SHA-256 digests). */
export function timingSafeEqualUtf8Secrets(a: string, b: string): boolean {
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}
