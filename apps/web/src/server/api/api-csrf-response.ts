import { NextResponse } from "next/server";

/** Stable JSON contract when CSRF proof is missing or invalid on cookie-authenticated unsafe methods. */
export const API_CSRF_INVALID_BODY = {
  error: "Invalid or missing CSRF token",
  code: "csrf_invalid",
} as const;

export function apiCsrfInvalidJson(): NextResponse {
  return NextResponse.json(API_CSRF_INVALID_BODY, { status: 403 });
}
