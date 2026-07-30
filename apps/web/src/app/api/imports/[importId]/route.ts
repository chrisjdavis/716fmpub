import { NextResponse } from "next/server";
import { getImportJobByIdForUser, getPool } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { importJobPathParamsSchema } from "@/server/api/auth-account-input-schemas";
import { importJobApiRowFromRecord } from "@/server/api/import-job-row";
import { emailVerificationRequiredUnlessSatisfied } from "@/server/api/email-verification-api-gate";
import { withApiSession } from "@/server/api/require-session";

type RouteContext = { params: Promise<{ importId: string }> };

export async function GET(
  req: Request,
  context: RouteContext,
): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const denied = emailVerificationRequiredUnlessSatisfied(user);
    if (denied) {
      return denied;
    }
    const params = await context.params;
    const parsedParams = importJobPathParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid import id" }, { status: 400 });
    }

    const env = loadServerEnv();
    const pool = getPool(env);
    let row: Awaited<ReturnType<typeof getImportJobByIdForUser>>;
    try {
      row = await getImportJobByIdForUser(pool, {
        jobId: parsedParams.data.importId,
        userId: user.id,
        source: "user",
      });
    } catch {
      return NextResponse.json(
        { error: "Invalid import job record" },
        { status: 500 },
      );
    }
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ import: importJobApiRowFromRecord(row) });
  });
}
