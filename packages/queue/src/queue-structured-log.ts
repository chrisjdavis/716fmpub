import { redactForLogLine } from "@vs/sensitive";

const SCHEMA_VERSION = 1;
const MESSAGE_CAP = 800;

export type QueueLogLevel = "debug" | "info" | "warn" | "error";

export type QueueActivityEvent =
  | "job_started"
  | "job_completed"
  | "job_failed"
  | "enqueue_ok"
  | "enqueue_validation_failed"
  | "enqueue_redis_failed"
  | "pipeline_progress"
  | "pipeline_warn"
  | "worker_bullmq_concurrency_config"
  | "worker_bullmq_runtime_error"
  | "producer_enqueue_failed"
  /** Worker HTTP call to Next.js to drop in-process user read caches after listen mutations. */
  | "web_read_cache_invalidation_failed"
  /** Worker HTTP call to Next.js for guided onboarding import-ready email dispatch. */
  | "web_onboarding_import_ready_notify_failed";

export type FailureSummary = {
  errorType: string;
  errorMessage: string;
};

/** BullMQ attempt identity for correlating DB rows with Redis jobs (no secrets). */
export type QueueJobTrace = {
  queue: string;
  bullmqJobId: string;
};

export type QueueActivityLogEntry = {
  level: QueueLogLevel;
  event: QueueActivityEvent;
  /** BullMQ queue name or logical queue label (e.g. incremental_sync tick label). */
  queue: string;
  bullmqJobId?: string;
  jobName?: string;
  userId?: string;
  importJobId?: string;
  exportJobId?: string;
  detail?: Record<string, string | number | boolean | null>;
  failure?: FailureSummary;
};

function truncateMessage(message: string, max: number): string {
  if (message.length <= max) {
    return message;
  }
  return `${message.slice(0, max - 24)}…[truncated]`;
}

export function summarizeFailure(err: unknown): FailureSummary {
  if (err instanceof Error) {
    return {
      errorType: err.name,
      errorMessage: redactForLogLine(truncateMessage(err.message, MESSAGE_CAP)),
    };
  }
  return {
    errorType: "non_error_throwable",
    errorMessage: redactForLogLine(truncateMessage(String(err), MESSAGE_CAP)),
  };
}

/**
 * Allow-lists identity fields from BullMQ `job.data` shapes we publish.
 * Does not stringify or forward unknown payload keys (avoids leaking secrets).
 */
export function extractSafeJobDataFields(
  data: unknown,
): Pick<QueueActivityLogEntry, "userId" | "importJobId" | "exportJobId"> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {};
  }
  const o = data as Record<string, unknown>;
  const out: Pick<QueueActivityLogEntry, "userId" | "importJobId" | "exportJobId"> = {};
  if (typeof o.userId === "string") {
    out.userId = o.userId;
  }
  if (typeof o.importJobId === "string") {
    out.importJobId = o.importJobId;
  }
  if (typeof o.exportJobId === "string") {
    out.exportJobId = o.exportJobId;
  }
  return out;
}

export function logQueueActivity(entry: QueueActivityLogEntry): void {
  const line = JSON.stringify({
    vs: { kind: "queue_activity", v: SCHEMA_VERSION },
    ts: new Date().toISOString(),
    component: "vs-queue",
    ...entry,
  });
  if (entry.level === "error") {
    console.error(line);
  } else if (entry.level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
