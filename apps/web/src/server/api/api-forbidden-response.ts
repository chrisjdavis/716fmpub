import { NextResponse } from "next/server";

/** Stable JSON contract for authenticated-but-not-authorized API access (no extra detail). */
export const API_FORBIDDEN_BODY = {
  error: "Forbidden",
  code: "forbidden",
} as const;

export function apiForbiddenJson(): NextResponse {
  return NextResponse.json(API_FORBIDDEN_BODY, { status: 403 });
}
