import { NextResponse } from "next/server";

/** Stable JSON contract for unauthenticated API access (middleware + `requireSession`). */
export const API_UNAUTHENTICATED_BODY = {
  error: "Authentication required",
  code: "unauthenticated",
} as const;

/** Session is valid but `users.email_verified_at` is null — client should prompt verify / resend. */
export const API_EMAIL_VERIFICATION_REQUIRED_BODY = {
  error: "Confirm your email address before using this feature.",
  code: "email_verification_required",
} as const;

export function apiAuthenticationRequiredJson(): NextResponse {
  return NextResponse.json(API_UNAUTHENTICATED_BODY, { status: 401 });
}
