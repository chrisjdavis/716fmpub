import { z } from "zod";
import { canonicalizeAccountEmail } from "@/server/auth/canonical-email";
import { signupPasswordValueSchema } from "@/server/auth/password-policy";

/**
 * Allowed `purpose` values for `POST /api/me/step-up`.
 * Must stay aligned with `STEP_UP_PURPOSES` in `@vs/db` (see schema contract test).
 */
export const API_STEP_UP_PURPOSES = [
  "purge_listen_data",
  "change_account_email",
  "delete_account",
] as const;

/** Shared by login, setup, and recovery request — normalize then validate email shape. */
const accountEmailFieldSchema = z
  .string()
  .max(320)
  .transform((s) => canonicalizeAccountEmail(s))
  .pipe(z.string().email().max(320));

export const authLoginBodySchema = z
  .object({
    email: accountEmailFieldSchema,
    password: z.string().min(1).max(256),
  })
  .strict();

export const authSetupBodySchema = z
  .object({
    email: accountEmailFieldSchema,
    password: signupPasswordValueSchema,
    /** Required when `VS_SETUP_BOOTSTRAP_SECRET` is configured for the instance. */
    bootstrapSecret: z.string().min(1).max(256).optional(),
  })
  .strict();

/** Logout accepts no JSON or exactly `{}` (no extra keys). */
export const authLogoutBodySchema = z.object({}).strict();

/** Resend email verification (session-authenticated; body is intentionally empty). */
export const meResendVerificationBodySchema = z.object({}).strict();

const RECOVERY_TOKEN_MAX_LEN = 96;

export const authRecoveryRequestBodySchema = z
  .object({
    email: accountEmailFieldSchema,
  })
  .strict();

export const authRecoveryConfirmBodySchema = z
  .object({
    token: z
      .string()
      .max(RECOVERY_TOKEN_MAX_LEN + 64)
      .transform((s) => s.trim())
      .pipe(
        z
          .string()
          .min(32, "Recovery token is required")
          .max(RECOVERY_TOKEN_MAX_LEN),
      ),
    password: signupPasswordValueSchema,
  })
  .strict();

/** Email verification token (opaque base64url from `issueEmailVerificationToken`). */
export const authVerifyEmailBodySchema = z
  .object({
    token: z
      .string()
      .max(RECOVERY_TOKEN_MAX_LEN + 64)
      .transform((s) => s.trim())
      .pipe(
        z
          .string()
          .min(32, "Verification token is required")
          .max(RECOVERY_TOKEN_MAX_LEN),
      ),
  })
  .strict();

/**
 * Email-change completion token (opaque base64url from `issueEmailChangeToken`; row in
 * `email_change_tokens`, not `email_verification_tokens`). Same JSON shape as signup verify;
 * separate export so routes and docs do not conflate the two lifecycles.
 */
export const authVerifyEmailChangeBodySchema = authVerifyEmailBodySchema;

export const exportListensPostBodySchema = z
  .object({
    format: z.enum(["json", "csv"]),
  })
  .strict();

export const importsPostBodySchema = z
  .object({
    label: z.string().min(1).max(200),
    lastfmUsername: z.preprocess(
      (v) => (typeof v === "string" ? v.trim() : v),
      z.string().min(1).max(64),
    ),
  })
  .strict();

export const meStepUpBodySchema = z
  .object({
    password: z.string().min(1).max(256),
    purpose: z.enum(API_STEP_UP_PURPOSES),
  })
  .strict();

const PURGE_CONFIRM_PHRASE_MAX_LEN = 200;
const STEP_UP_TOKEN_MAX_LEN = 512;

export const purgeListenDataBodySchema = z
  .object({
    confirmPhrase: z.string().min(1).max(PURGE_CONFIRM_PHRASE_MAX_LEN),
    stepUpToken: z
      .string()
      .max(STEP_UP_TOKEN_MAX_LEN + 64)
      .transform((s) => s.trim())
      .pipe(z.string().min(1, "Step-up token is required").max(STEP_UP_TOKEN_MAX_LEN)),
  })
  .strict();

export const deleteAccountBodySchema = purgeListenDataBodySchema;

export const meEmailChangeRequestBodySchema = z
  .object({
    newEmail: accountEmailFieldSchema,
    stepUpToken: z
      .string()
      .max(STEP_UP_TOKEN_MAX_LEN + 64)
      .transform((s) => s.trim())
      .pipe(z.string().min(1, "Step-up token is required").max(STEP_UP_TOKEN_MAX_LEN)),
  })
  .strict();

export const importJobPathParamsSchema = z
  .object({
    importId: z.string().uuid(),
  })
  .strict();

export const exportJobIdPathParamSchema = z.string().uuid();

/**
 * Opaque delivery token for export artifact download.
 * Accepted via `Authorization: Bearer …` (preferred) or legacy `?token=` query.
 */
export const exportArtifactDeliveryTokenSchema = z
  .string()
  .trim()
  .min(32, "export delivery token too short")
  .max(128, "export delivery token too long");

/** @deprecated Prefer {@link exportArtifactDeliveryTokenSchema}. */
export const exportArtifactDeliveryTokenQuerySchema = exportArtifactDeliveryTokenSchema;
