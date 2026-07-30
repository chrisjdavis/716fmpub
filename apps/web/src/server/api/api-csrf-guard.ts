import type { NextResponse } from "next/server";
import { apiCsrfInvalidJson } from "@/server/api/api-csrf-response";
import { csrfDoubleSubmitValid, isUnsafeHttpMethod } from "@/server/auth/csrf-cookie";

/**
 * For cookie-authenticated API routes: unsafe HTTP methods require a matching CSRF cookie + header.
 * Returns a JSON 403 when proof is missing or invalid; returns null when the method is safe or proof is valid.
 */
export async function cookieAuthCsrfProofOr403(
  request: Request,
): Promise<NextResponse | null> {
  if (!isUnsafeHttpMethod(request.method)) {
    return null;
  }
  const ok = await csrfDoubleSubmitValid(request);
  if (!ok) {
    return apiCsrfInvalidJson();
  }
  return null;
}
