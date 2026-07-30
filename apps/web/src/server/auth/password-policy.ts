import { z } from "zod";

/**
 * Password policy for new passwords at signup and at password-recovery completion (`POST /api/auth/recovery/confirm`).
 * Login and step-up accept any stored password shape; policy applies when choosing a new password.
 * Prefer length and a minimal diversity check over brittle composition rules (OWASP Password Storage Cheat Sheet).
 */
export const PASSWORD_SIGNUP_MIN_LENGTH = 12;
export const PASSWORD_SIGNUP_MAX_LENGTH = 256;

export const signupPasswordValueSchema = z
  .string()
  .min(
    PASSWORD_SIGNUP_MIN_LENGTH,
    `Password must be at least ${PASSWORD_SIGNUP_MIN_LENGTH} characters`,
  )
  .max(
    PASSWORD_SIGNUP_MAX_LENGTH,
    `Password must be at most ${PASSWORD_SIGNUP_MAX_LENGTH} characters`,
  )
  .refine((p) => new Set(p).size >= 2, {
    message: "Password must use at least two distinct characters",
  });
