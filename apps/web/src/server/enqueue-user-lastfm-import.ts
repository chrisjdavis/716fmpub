import type { Pool } from "pg";
import {
  countActiveImportJobsForUser,
  createImportJob,
  isPostgresUniqueViolation,
  markImportJobFailed,
  tryInsertSecurityAuditEvent,
} from "@vs/db";
import type { ServerEnv } from "@vs/env";
import { isRedisQueuesEnabled } from "@vs/env";
import {
  createImportsQueue,
  enqueueImportsJob,
  IMPORTS_QUEUE_JOB_NAME,
} from "@vs/queue";
import { summarizeThrowableForLog } from "@vs/sensitive";

export type EnqueueUserLastfmImportResult =
  | Readonly<{
      ok: true;
      importJobId: string;
      queueJobId: string;
      alreadyActive: false;
    }>
  | Readonly<{
      ok: true;
      importJobId: string;
      /** BullMQ id when known; null for pre-existing rows surfaced idempotently. */
      queueJobId: string | null;
      alreadyActive: true;
    }>
  | Readonly<{ ok: false; code: "redis_queues_disabled" }>
  | Readonly<{ ok: false; code: "import_already_queued_or_running" }>
  | Readonly<{ ok: false; code: "import_enqueue_failed"; message: string }>;

/**
 * Creates a user-sourced Last.fm import row and enqueues BullMQ work, matching `POST /api/imports`.
 * When an import is already active: returns `alreadyActive: true` if `allowIdempotentActive` is set;
 * otherwise returns `import_already_queued_or_running`.
 */
export async function enqueueUserLastfmImport(input: {
  pool: Pool;
  env: ServerEnv;
  userId: string;
  label: string;
  lastfmUsername: string;
  /** When true, an existing queued/running user import succeeds with `alreadyActive` instead of an error. */
  allowIdempotentActive?: boolean;
  /** When true, record `import.trigger` audit outcomes (used by `POST /api/imports`). */
  auditImportTrigger?: boolean;
}): Promise<EnqueueUserLastfmImportResult> {
  const {
    pool,
    env,
    userId,
    label,
    lastfmUsername,
    allowIdempotentActive = false,
    auditImportTrigger = false,
  } = input;

  if (!isRedisQueuesEnabled(env)) {
    if (auditImportTrigger) {
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: userId,
        action: "import.trigger",
        outcome: "failure",
        metadata: { reason: "redis_queues_disabled" },
      });
    }
    return { ok: false, code: "redis_queues_disabled" };
  }

  const active = await countActiveImportJobsForUser(pool, userId);
  if (active > 0) {
    const { rows } = await pool.query<{ id: string }>(
      `select id
       from import_jobs
       where user_id = $1::uuid
         and source = 'user'
         and stage in ('queued', 'running')
       order by created_at desc, id desc
       limit 1`,
      [userId],
    );
    const row = rows[0];
    if (row) {
      if (allowIdempotentActive) {
        return {
          ok: true,
          importJobId: String(row.id),
          queueJobId: null,
          alreadyActive: true,
        };
      }
      if (auditImportTrigger) {
        await tryInsertSecurityAuditEvent(pool, {
          actorUserId: userId,
          action: "import.trigger",
          outcome: "failure",
          metadata: { reason: "import_already_queued_or_running" },
        });
      }
      return { ok: false, code: "import_already_queued_or_running" };
    }
    if (auditImportTrigger) {
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: userId,
        action: "import.trigger",
        outcome: "failure",
        metadata: { reason: "import_already_queued_or_running" },
      });
    }
    return { ok: false, code: "import_already_queued_or_running" };
  }

  let created: { id: string };
  try {
    created = await createImportJob(pool, {
      userId,
      label,
      lastfmUsername,
      source: "user",
    });
  } catch (err) {
    if (isPostgresUniqueViolation(err)) {
      if (auditImportTrigger) {
        await tryInsertSecurityAuditEvent(pool, {
          actorUserId: userId,
          action: "import.trigger",
          outcome: "failure",
          metadata: { reason: "import_already_queued_or_running" },
        });
      }
      return { ok: false, code: "import_already_queued_or_running" };
    }
    throw err;
  }

  const queue = createImportsQueue(env);
  try {
    const job = await enqueueImportsJob(queue, {
      name: IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT,
      data: { importJobId: created.id, userId },
    });
    if (auditImportTrigger) {
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: userId,
        action: "import.trigger",
        outcome: "success",
        metadata: { importJobId: created.id },
      });
    }
    return {
      ok: true,
      importJobId: created.id,
      queueJobId: String(job.id),
      alreadyActive: false,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : `non-Error throw: ${String(err)}`;
    try {
      await markImportJobFailed(pool, {
        jobId: created.id,
        userId,
        errorMessage: `BullMQ enqueue failed: ${message}`,
      });
    } catch (markErr) {
      console.error(
        `[enqueueUserLastfmImport] markImportJobFailed failed after BullMQ enqueue error importJobId=${created.id}:`,
        summarizeThrowableForLog(markErr),
        summarizeThrowableForLog(err),
      );
    }
    if (auditImportTrigger) {
      await tryInsertSecurityAuditEvent(pool, {
        actorUserId: userId,
        action: "import.trigger",
        outcome: "failure",
        metadata: { reason: "import_enqueue_failed", importJobId: created.id },
      });
    }
    return { ok: false, code: "import_enqueue_failed", message };
  } finally {
    await queue.close();
  }
}
