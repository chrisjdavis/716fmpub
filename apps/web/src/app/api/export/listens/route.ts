import { NextResponse } from "next/server";
import {
  countActiveExportJobsForUser,
  createExportJob,
  getPool,
  isPostgresUniqueViolation,
  markExportJobFailedWhenQueued,
  setExportJobBullmqJobId,
  tryInsertSecurityAuditEvent,
} from "@vs/db";
import { isRedisQueuesEnabled, loadServerEnv } from "@vs/env";
import {
  createExportsQueue,
  enqueueExportsJob,
  EXPORTS_QUEUE_JOB_NAME,
} from "@vs/queue";
import { summarizeThrowableForLog } from "@vs/sensitive";
import { exportListensPostBodySchema } from "@/server/api/auth-account-input-schemas";
import { parseJsonBodyWithSchema } from "@/server/api/validated-json-body";
import { emailVerificationRequiredUnlessSatisfied } from "@/server/api/email-verification-api-gate";
import { withApiSession } from "@/server/api/require-session";

/**
 * Queue a full listen export for the signed-in user. The worker materializes a ZIP
 * under `EXPORT_ARTIFACTS_DIR`; poll `GET /api/export/listens/:exportJobId` for status.
 */
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
      exportListensPostBodySchema,
      env.VS_API_JSON_BODY_MAX_IMPORT_EXPORT_BYTES,
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    if (!isRedisQueuesEnabled(env)) {
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: user.id,
        action: "export.generate",
        outcome: "failure",
        metadata: { reason: "redis_queues_disabled" },
      });
      return NextResponse.json(
        {
          error:
            "Background exports require Redis/BullMQ, which is disabled for this server (FEATURE_FLAGS skipRedisQueues).",
          code: "redis_queues_disabled",
        },
        { status: 503 },
      );
    }

    const activeExports = await countActiveExportJobsForUser(pool, user.id);
    if (activeExports > 0) {
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: user.id,
        action: "export.generate",
        outcome: "failure",
        metadata: { reason: "export_already_queued_or_running" },
      });
      return NextResponse.json(
        {
          error: "An export is already queued or running for this account.",
          code: "export_already_queued_or_running",
        },
        { status: 409 },
      );
    }

    let created: { id: string };
    try {
      created = await createExportJob(pool, {
        userId: user.id,
        format: parsed.data.format,
      });
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        await tryInsertSecurityAuditEvent(pool, {
          actorUserId: user.id,
          action: "export.generate",
          outcome: "failure",
          metadata: { reason: "export_already_queued_or_running" },
        });
        return NextResponse.json(
          {
            error: "An export is already queued or running for this account.",
            code: "export_already_queued_or_running",
          },
          { status: 409 },
        );
      }
      throw err;
    }

    const queue = createExportsQueue(env);
    try {
      const job = await enqueueExportsJob(
        queue,
        {
          name: EXPORTS_QUEUE_JOB_NAME.USER_DATA_PACKAGE,
          data: { exportJobId: created.id, userId: user.id },
        },
        { jobId: created.id },
      );
      const bullmqJobId = String(job.id);
      await setExportJobBullmqJobId(pool, {
        exportJobId: created.id,
        userId: user.id,
        bullmqJobId,
      });
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: user.id,
        action: "export.generate",
        outcome: "success",
        metadata: { exportJobId: created.id, format: parsed.data.format },
      });
      return NextResponse.json(
        {
          exportJob: { id: created.id },
          queueJob: { id: bullmqJobId },
          statusPath: `/api/export/listens/${created.id}`,
        },
        { status: 202 },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : `non-Error throw: ${String(err)}`;
      try {
        await markExportJobFailedWhenQueued(pool, {
          exportJobId: created.id,
          userId: user.id,
          errorMessage: `BullMQ enqueue failed: ${message}`,
        });
      } catch (markErr) {
        console.error(
          `[api/export/listens] markExportJobFailedWhenQueued failed after BullMQ enqueue error exportJobId=${created.id}:`,
          summarizeThrowableForLog(markErr),
          summarizeThrowableForLog(err),
        );
      }
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: user.id,
        action: "export.generate",
        outcome: "failure",
        metadata: { reason: "export_enqueue_failed", exportJobId: created.id },
      });
      return NextResponse.json(
        {
          error: "Could not queue export job (Redis/BullMQ).",
          code: "export_enqueue_failed",
        },
        { status: 503 },
      );
    } finally {
      await queue.close();
    }
  });
}
