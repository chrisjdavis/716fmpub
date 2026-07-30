import { NextResponse } from "next/server";
import { getPool, IMPORT_JOBS_USER_SCOPED_NEWEST_FIRST_ORDER_BY } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { importsPostBodySchema } from "@/server/api/auth-account-input-schemas";
import {
  importJobApiRowFromDb,
  type ImportJobApiRow,
} from "@/server/api/import-job-row";
import { emailVerificationRequiredUnlessSatisfied } from "@/server/api/email-verification-api-gate";
import { parseJsonBodyWithSchema } from "@/server/api/validated-json-body";
import { withApiSession } from "@/server/api/require-session";
import { enqueueUserLastfmImport } from "@/server/enqueue-user-lastfm-import";

export async function GET(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const denied = emailVerificationRequiredUnlessSatisfied(user);
    if (denied) {
      return denied;
    }
    const env = loadServerEnv();
    const pool = getPool(env);
    const { rows } = await pool.query<{
      id: string;
      label: string;
      lastfm_username: string;
      source: string;
      stage: string;
      error_message: string | null;
      items_total: number | null;
      items_processed: number;
      checkpoint_pages_completed: number;
      checkpoint_oldest_uts: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `select id, label, lastfm_username, source, stage, error_message, items_total, items_processed, checkpoint_pages_completed, checkpoint_oldest_uts, created_at, updated_at
     from import_jobs
     where user_id = $1::uuid
       and source = 'user'
     order by ${IMPORT_JOBS_USER_SCOPED_NEWEST_FIRST_ORDER_BY}`,
      [user.id],
    );
    const ordered: ImportJobApiRow[] = [];
    for (const row of rows) {
      const parsed = importJobApiRowFromDb(row);
      if (!parsed) {
        return NextResponse.json(
          { error: "Invalid import job record" },
          { status: 500 },
        );
      }
      ordered.push(parsed);
    }
    const latest = ordered[0] ?? null;
    const history = ordered.slice(1);
    return NextResponse.json({ latest, history });
  });
}

export async function POST(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const denied = emailVerificationRequiredUnlessSatisfied(user);
    if (denied) {
      return denied;
    }
    const env = loadServerEnv();
    const pool = getPool(env);
    const parsed = await parseJsonBodyWithSchema(
      req,
      importsPostBodySchema,
      env.VS_API_JSON_BODY_MAX_IMPORT_EXPORT_BYTES,
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    const out = await enqueueUserLastfmImport({
      pool,
      env,
      userId: user.id,
      label: parsed.data.label,
      lastfmUsername: parsed.data.lastfmUsername,
      allowIdempotentActive: false,
      auditImportTrigger: true,
    });

    if (out.ok) {
      return NextResponse.json(
        {
          import: { id: out.importJobId },
          queueJob: { id: out.queueJobId },
        },
        { status: 201 },
      );
    }

    if (out.code === "redis_queues_disabled") {
      return NextResponse.json(
        {
          error:
            "Background imports require Redis/BullMQ, which is disabled for this server (FEATURE_FLAGS skipRedisQueues).",
          code: "redis_queues_disabled",
        },
        { status: 503 },
      );
    }

    if (out.code === "import_already_queued_or_running") {
      return NextResponse.json(
        {
          error: "An import is already queued or running for this account.",
          code: "import_already_queued_or_running",
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        error: "Could not queue import job (Redis/BullMQ).",
        code: "import_enqueue_failed",
      },
      { status: 503 },
    );
  });
}
