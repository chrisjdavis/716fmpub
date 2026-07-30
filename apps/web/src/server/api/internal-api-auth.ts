import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { ServerEnv } from "@vs/env";

const INTERNAL_DISABLED_BODY = {
  error: "Internal API is not configured for this deployment",
  code: "internal_api_disabled",
} as const;

const INTERNAL_FORBIDDEN_BODY = {
  error: "Forbidden",
  code: "internal_api_forbidden",
} as const;

function timingSafeEqualUtf8Strings(a: string, b: string): boolean {
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}

function readBearerToken(authorization: string | null): string | null {
  if (!authorization?.trim()) {
    return null;
  }
  const m = /^Bearer\s+(\S+)/i.exec(authorization.trim());
  return m?.[1] ?? null;
}

/**
 * Validates `Authorization: Bearer …` against `VS_INTERNAL_API_SECRET`.
 * When the secret is unset, returns `503` with `internal_api_disabled` (operators see a clear state).
 */
export function requireInternalApiAuth(
  req: Request,
  env: ServerEnv,
): NextResponse | null {
  const expected = env.VS_INTERNAL_API_SECRET;
  if (expected === undefined || expected.length === 0) {
    return NextResponse.json(INTERNAL_DISABLED_BODY, { status: 503 });
  }
  const presented = readBearerToken(req.headers.get("authorization"));
  if (!presented || !timingSafeEqualUtf8Strings(presented, expected)) {
    return NextResponse.json(INTERNAL_FORBIDDEN_BODY, { status: 403 });
  }
  return null;
}
