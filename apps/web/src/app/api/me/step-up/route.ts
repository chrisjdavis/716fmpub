import { NextResponse } from "next/server";
import {
  getPool,
  issueStepUpToken,
  STEP_UP_TOKEN_TTL_MS,
  type StepUpPurpose,
} from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { meStepUpBodySchema } from "@/server/api/auth-account-input-schemas";
import { parseJsonBodyWithSchema } from "@/server/api/validated-json-body";
import { withApiSession } from "@/server/api/require-session";
import { verifyPassword } from "@/server/auth/password";
import { findUserPasswordHashById } from "@/server/auth/user-repository";

const PASSWORD_VERIFY_FAILED = "Password verification failed";

export async function POST(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const env = loadServerEnv();
    const parsed = await parseJsonBodyWithSchema(
      req,
      meStepUpBodySchema,
      env.VS_API_JSON_BODY_MAX_ACCOUNT_BYTES,
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    const pool = getPool(env);
    const row = await findUserPasswordHashById(pool, user.id);
    if (!row) {
      return NextResponse.json({ error: PASSWORD_VERIFY_FAILED, code: "step_up_password_invalid" }, { status: 401 });
    }

    const ok = await verifyPassword(parsed.data.password, row.password_hash);
    if (!ok) {
      return NextResponse.json({ error: PASSWORD_VERIFY_FAILED, code: "step_up_password_invalid" }, { status: 401 });
    }

    const purpose: StepUpPurpose = parsed.data.purpose;
    const issued = await issueStepUpToken(pool, user.id, purpose);

    return NextResponse.json({
      ok: true,
      token: issued.rawToken,
      expiresAt: issued.expiresAt.toISOString(),
      purpose,
      ttlMs: STEP_UP_TOKEN_TTL_MS,
    });
  });
}
