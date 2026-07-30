import { createHmac, timingSafeEqual } from "node:crypto";

const SEP = ".";

export type ListenRealtimeTokenPayload = Readonly<{
  sub: string;
  exp: number;
}>;

function encodePayload(userId: string, expSeconds: number): string {
  const json = JSON.stringify({ sub: userId, exp: expSeconds } satisfies ListenRealtimeTokenPayload);
  return Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Short-lived token for the listen WebSocket handshake (HMAC over base64url JSON payload).
 */
export function signListenRealtimeToken(
  secret: string,
  userId: string,
  ttlSeconds: number,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = encodePayload(userId, exp);
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}${SEP}${sig}`;
}

/**
 * Returns the user id when the token is well-formed, signature-valid, and unexpired.
 */
export function verifyListenRealtimeToken(
  secret: string,
  token: string,
): { userId: string } | null {
  const i = token.lastIndexOf(SEP);
  if (i <= 0 || i === token.length - 1) {
    return null;
  }
  const payload = token.slice(0, i);
  const sigHex = token.slice(i + 1);
  if (!/^[0-9a-f]+$/i.test(sigHex)) {
    return null;
  }
  const expectedHex = createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(expectedHex, "utf8");
  const b = Buffer.from(sigHex, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const rec = parsed as Record<string, unknown>;
  const sub = rec["sub"];
  const exp = rec["exp"];
  if (typeof sub !== "string" || sub.trim() === "") {
    return null;
  }
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    return null;
  }
  if (exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return { userId: sub };
}
