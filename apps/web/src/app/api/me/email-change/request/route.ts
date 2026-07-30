import { NextResponse } from "next/server";
import {
  getPool,
  issueEmailChangeToken,
  STEP_UP_PURPOSE_CHANGE_ACCOUNT_EMAIL,
  tryInsertSecurityAuditEvent,
  withConsumedStepUpToken,
  type SecurityAuditMetadata,
} from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { summarizeThrowableForLog } from "@vs/sensitive";
import { meEmailChangeRequestBodySchema } from "@/server/api/auth-account-input-schemas";
import { emailVerificationRequiredUnlessSatisfied } from "@/server/api/email-verification-api-gate";
import { parseJsonBodyWithSchema } from "@/server/api/validated-json-body";
import { withApiSession } from "@/server/api/require-session";
import { buildEmailChangeVerificationAbsoluteUrl } from "@/server/auth/email-change-verification-url";
import { getWebTransactionalMailer } from "@/server/transactional-mailer";

type Dispatch =
  | { status: "sent" }
  | { status: "skipped"; reason: "public_app_origin_missing" | "email_not_configured" }
  | { status: "failed"; reason: "provider_error" };

export async function POST(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const denied = emailVerificationRequiredUnlessSatisfied(user);
    if (denied) {
      return denied;
    }

    const env = loadServerEnv();
    const parsed = await parseJsonBodyWithSchema(
      req,
      meEmailChangeRequestBodySchema,
      env.VS_API_JSON_BODY_MAX_ACCOUNT_BYTES,
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    if (parsed.data.newEmail === user.email) {
      return NextResponse.json(
        {
          error: "Choose a different email address than your current sign-in email.",
          code: "same_email" as const,
        },
        { status: 400 },
      );
    }

    const pool = getPool(env);
    const dup = await pool.query<{ id: string }>(
      `select id from users where email = $1 limit 1`,
      [parsed.data.newEmail],
    );
    if (dup.rows[0]) {
      // Consume step-up so probes cannot reuse one confirmation across many emails.
      const step = await withConsumedStepUpToken(
        pool,
        {
          userId: user.id,
          purpose: STEP_UP_PURPOSE_CHANGE_ACCOUNT_EMAIL,
          rawToken: parsed.data.stepUpToken,
        },
        async () => undefined,
      );
      if (!step.ok) {
        await tryInsertSecurityAuditEvent(pool, {
          actorUserId: user.id,
          action: "account.email_change_request",
          outcome: "denied",
          metadata: { reason: step.reason },
        });
        const byReason = {
          invalid_token: {
            code: "step_up_invalid" as const,
            error: "Step-up confirmation is missing or not valid for this action.",
          },
          expired: {
            code: "step_up_expired" as const,
            error: "Step-up confirmation has expired. Re-enter your password to continue.",
          },
          replayed: {
            code: "step_up_replayed" as const,
            error: "This step-up confirmation was already used.",
          },
          wrong_user: {
            code: "step_up_invalid" as const,
            error: "Step-up confirmation is missing or not valid for this action.",
          },
        };
        const payload = byReason[step.reason];
        return NextResponse.json({ error: payload.error, code: payload.code }, { status: 403 });
      }
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: user.id,
        action: "account.email_change_request",
        outcome: "denied",
        metadata: { reason: "email_taken" },
      });
      // Uniform success shape (anti-enumeration); no token issued and no mail sent.
      return NextResponse.json({
        ok: true as const,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        verificationDispatch: { status: "sent" as const },
        noticeDispatch: { status: "sent" as const },
      });
    }

    const step = await withConsumedStepUpToken(
      pool,
      {
        userId: user.id,
        purpose: STEP_UP_PURPOSE_CHANGE_ACCOUNT_EMAIL,
        rawToken: parsed.data.stepUpToken,
      },
      (client) => issueEmailChangeToken(client, user.id, parsed.data.newEmail),
    );

    if (!step.ok) {
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: user.id,
        action: "account.email_change_request",
        outcome: "denied",
        metadata: { reason: step.reason },
      });
      const byReason = {
        invalid_token: {
          code: "step_up_invalid" as const,
          error: "Step-up confirmation is missing or not valid for this action.",
        },
        expired: {
          code: "step_up_expired" as const,
          error: "Step-up confirmation has expired. Re-enter your password to continue.",
        },
        replayed: {
          code: "step_up_replayed" as const,
          error: "This step-up confirmation was already used.",
        },
        wrong_user: {
          code: "step_up_invalid" as const,
          error: "Step-up confirmation is missing or not valid for this action.",
        },
      };
      const payload = byReason[step.reason];
      return NextResponse.json({ error: payload.error, code: payload.code }, { status: 403 });
    }

    const { rawToken, expiresAt } = step.value;
    const origin = env.publicAppOrigin?.trim();
    const mailer = getWebTransactionalMailer();
    const attemptedAtIso = new Date().toISOString();

    let verificationDispatch: Dispatch;
    let noticeDispatch: Dispatch;

    if (!origin) {
      verificationDispatch = { status: "skipped", reason: "public_app_origin_missing" };
      noticeDispatch = { status: "skipped", reason: "public_app_origin_missing" };
    } else if (!mailer) {
      verificationDispatch = { status: "skipped", reason: "email_not_configured" };
      noticeDispatch = { status: "skipped", reason: "email_not_configured" };
    } else {
      const verificationUrl = buildEmailChangeVerificationAbsoluteUrl(origin, rawToken);
      const securitySettingsUrl = new URL("/dashboard/settings", origin).toString();
      try {
        await mailer.sendEmailChangeVerification({
          to: parsed.data.newEmail,
          verificationUrl,
        });
        verificationDispatch = { status: "sent" };
      } catch (err) {
        console.error(
          `[api/me/email-change/request] verification send failed userId=${user.id}:`,
          summarizeThrowableForLog(err),
        );
        verificationDispatch = { status: "failed", reason: "provider_error" };
      }
      try {
        await mailer.sendEmailChangeAttemptNotice({
          to: user.email,
          attemptedAtIso,
          securitySettingsUrl,
        });
        noticeDispatch = { status: "sent" };
      } catch (err) {
        console.error(
          `[api/me/email-change/request] notice send failed userId=${user.id}:`,
          summarizeThrowableForLog(err),
        );
        noticeDispatch = { status: "failed", reason: "provider_error" };
      }
    }

    const mailDeliverySucceeded =
      verificationDispatch.status === "sent" && noticeDispatch.status === "sent";
    const auditMetadata: SecurityAuditMetadata = {
      verificationStatus: verificationDispatch.status,
      noticeStatus: noticeDispatch.status,
    };
    if (verificationDispatch.status === "skipped") {
      auditMetadata.verificationSkipReason = verificationDispatch.reason;
    }
    if (verificationDispatch.status === "failed") {
      auditMetadata.verificationFailureReason = verificationDispatch.reason;
    }
    if (noticeDispatch.status === "skipped") {
      auditMetadata.noticeSkipReason = noticeDispatch.reason;
    }
    if (noticeDispatch.status === "failed") {
      auditMetadata.noticeFailureReason = noticeDispatch.reason;
    }

    await tryInsertSecurityAuditEvent(pool, {
      actorUserId: user.id,
      action: "account.email_change_request",
      outcome: mailDeliverySucceeded ? "success" : "failure",
      metadata: auditMetadata,
    });

    return NextResponse.json({
      ok: true as const,
      expiresAt: expiresAt.toISOString(),
      verificationDispatch,
      noticeDispatch,
    });
  });
}
