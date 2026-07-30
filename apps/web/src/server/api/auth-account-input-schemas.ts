import { ACCOUNT_ROLES, ACCOUNT_STATUSES, PRODUCT_PLANS } from "@vs/domain";
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

/** Shared by login, signup, and recovery request — normalize then validate email shape. */
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

const signupInviteTokenSchema = z
  .string()
  .max(128)
  .transform((s) => s.trim())
  .pipe(z.string().min(32, "Invite code is required").max(128));

export const authSignupBodySchema = z
  .object({
    email: accountEmailFieldSchema,
    password: signupPasswordValueSchema,
    inviteToken: signupInviteTokenSchema,
  })
  .strict();

export const authSetupBodySchema = z
  .object({
    email: accountEmailFieldSchema,
    password: signupPasswordValueSchema,
  })
  .strict();


/** Logout accepts no JSON or exactly `{}` (no extra keys). */
export const authLogoutBodySchema = z.object({}).strict();

/** Resend signup verification email (session-authenticated; body is intentionally empty). */
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

/** Signup email verification token (opaque base64url from `issueEmailVerificationToken`). */
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

/** Path params for `PATCH /api/admin/users/:userId`. */
export const adminUserPathParamsSchema = z
  .object({
    userId: z.string().uuid(),
  })
  .strict();

const adminAccountRoleFieldSchema = z.enum(ACCOUNT_ROLES);
const adminAccountStatusFieldSchema = z.enum(ACCOUNT_STATUSES);
const adminProductPlanFieldSchema = z.enum(PRODUCT_PLANS);

/** `PATCH /api/admin/users/:userId` — exactly one mutation field per request. */
export const adminUserPatchBodySchema = z
  .object({
    accountRole: adminAccountRoleFieldSchema.optional(),
    accountStatus: adminAccountStatusFieldSchema.optional(),
    productPlan: adminProductPlanFieldSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const n =
      (val.accountRole !== undefined ? 1 : 0) +
      (val.accountStatus !== undefined ? 1 : 0) +
      (val.productPlan !== undefined ? 1 : 0);
    if (n !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Exactly one of accountRole, accountStatus, or productPlan is required",
        path: [],
      });
    }
  });

/** Path params for `POST /api/admin/invites/:inviteId/revoke`. */
export const adminInvitePathParamsSchema = z
  .object({
    inviteId: z.string().uuid(),
  })
  .strict();

const ADMIN_INVITE_MAX_USES = 10_000;

/** `POST /api/admin/invites` — strict JSON; unknown keys rejected. */
export const adminInviteCreateBodySchema = z
  .object({
    maxUses: z.number().int().min(1).max(ADMIN_INVITE_MAX_USES),
    lockedEmail: z.union([accountEmailFieldSchema, z.null()]).optional(),
    expiresAt: z.union([z.string().datetime({ offset: true }), z.null()]).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.expiresAt === undefined || val.expiresAt === null) {
      return;
    }
    const ms = Date.parse(val.expiresAt);
    if (!Number.isFinite(ms)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid expiresAt",
        path: ["expiresAt"],
      });
      return;
    }
    if (ms <= Date.now()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expiresAt must be in the future",
        path: ["expiresAt"],
      });
    }
  });

/** Query string for `GET /api/admin/invites` (only known keys from the handler). */
export const adminInviteListQuerySchema = z
  .object({
    lifecycle: z.enum(["revoked", "expired", "exhausted", "active"]).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

/** Query string for `GET /api/admin/users` (only known keys from the handler). */
export const adminUserListQuerySchema = z
  .object({
    q: z
      .string()
      .max(200)
      .optional()
      .transform((s) => {
        if (s === undefined) {
          return undefined;
        }
        const t = s.trim();
        return t === "" ? undefined : t;
      }),
    /** When set, restricts results to this `users.product_plan`. */
    productPlan: z.enum(PRODUCT_PLANS).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    cursor: z
      .string()
      .max(512)
      .optional()
      .transform((s) => {
        if (s === undefined) {
          return undefined;
        }
        const t = s.trim();
        return t === "" ? undefined : t;
      }),
  })
  .strict();

/** `POST /api/admin/invites/:inviteId/revoke` body (empty `{}` allowed). */
export const adminInviteRevokeBodySchema = z
  .object({
    reason: z.string().max(500).optional(),
  })
  .strict();

export const exportJobIdPathParamSchema = z.string().uuid();

/** Query param for `GET /api/export/listens/:id/download?token=` (worker-issued secret). */
export const exportArtifactDeliveryTokenQuerySchema = z
  .string()
  .trim()
  .min(32, "export delivery token too short")
  .max(128, "export delivery token too long");
