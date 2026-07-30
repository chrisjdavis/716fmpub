import { NextResponse } from "next/server";
import type { AuthenticatedUser } from "@/server/auth/session";

/**
 * OSS single-user build: email verification is not required.
 * Setup marks the owner verified; this gate always allows the request.
 */
export function emailVerificationRequiredUnlessSatisfied(
  _user: AuthenticatedUser,
): NextResponse | null {
  return null;
}
