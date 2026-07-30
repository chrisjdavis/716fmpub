import { Queue, type Job } from "bullmq";
import { redactForLogLine, redactUnknownStructured } from "@vs/sensitive";
import type { ServerEnv } from "@vs/env";

import { VS_QUEUE_NAMES, type VsQueueName } from "./queue-names.js";
import { createBullMqRedisConnection } from "./redis-connection.js";

/**
 * Which BullMQ `getJobs` bucket we sampled. `waiting` uses BullMQ’s merged
 * waiting+paused fetch, but we only **emit** rows whose resolved `bullmqState`
 * is `waiting` so paused work is not mislabeled and does not duplicate the
 * `paused` bucket.
 */
export const QUEUE_INSPECTION_SAMPLE_FETCH_BUCKETS = [
  "waiting",
  "paused",
  "active",
  "failed",
  "completed",
  "delayed",
  "prioritized",
] as const;

export type QueueInspectionSampleFetchBucket =
  (typeof QUEUE_INSPECTION_SAMPLE_FETCH_BUCKETS)[number];

export const QUEUE_INSPECTION_DEFAULT_JOB_SAMPLE_LIMIT = 15;

export const QUEUE_INSPECTION_JOB_SAMPLE_LIMIT_HARD_CAP = 500;

export const QUEUE_INSPECTION_DATA_PREVIEW_MAX_CHARS = 240;

export const QUEUE_INSPECTION_FAILED_REASON_MAX_CHARS = 500;

/**
 * Canonical queues in deterministic sorted order (for stable CLI / log output).
 */
export function sortedCanonicalVsQueueNames(): VsQueueName[] {
  return [...(Object.values(VS_QUEUE_NAMES) as VsQueueName[])].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function formatIsoOrNull(ms: number | undefined | null): string | null {
  if (ms == null || typeof ms !== "number" || Number.isNaN(ms)) {
    return null;
  }
  return new Date(ms).toISOString();
}

export function truncateForInspection(
  value: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  return { text: value.slice(0, maxChars) + "…", truncated: true };
}

export function jsonPreviewForInspection(
  data: unknown,
  maxChars: number,
): { preview: string; truncated: boolean } {
  let s: string;
  try {
    if (typeof data === "string") {
      s = redactForLogLine(data);
    } else {
      s = JSON.stringify(redactUnknownStructured(data));
    }
  } catch {
    s = "[unserializable job data]";
  }
  s = redactForLogLine(s);
  const t = truncateForInspection(s, maxChars);
  return { preview: t.text, truncated: t.truncated };
}

/** Redis count key used to decide `listTruncated` for a sample bucket. */
export function inspectionBucketCount(
  counts: Record<string, number>,
  bucket: QueueInspectionSampleFetchBucket,
): number {
  return counts[bucket] ?? 0;
}

/**
 * Whether a job resolved to `bullmqState` should appear under this sample bucket.
 * Keeps the `waiting` BullMQ fetch honest: merged fetch, but only true `waiting`
 * rows are emitted; paused jobs appear only under the `paused` bucket.
 */
export function shouldEmitJobForSampleBucket(
  bucket: QueueInspectionSampleFetchBucket,
  bullmqState: string,
): boolean {
  if (bullmqState === "unknown") {
    return false;
  }
  if (bucket === "waiting") {
    return bullmqState === "waiting";
  }
  if (bucket === "paused") {
    return bullmqState === "paused";
  }
  return bullmqState === bucket;
}

const WAITING_SAMPLE_MAX_START_OFFSET = 100_000;

async function sampleJobsForBucket(
  queue: Queue,
  queueName: VsQueueName,
  bucket: QueueInspectionSampleFetchBucket,
  jobSampleLimitPerList: number,
): Promise<QueueInspectionJobRow[]> {
  if (jobSampleLimitPerList <= 0) {
    return [];
  }
  if (bucket === "waiting") {
    return sampleTrueWaitingJobs(queue, queueName, jobSampleLimitPerList);
  }
  const end = jobSampleLimitPerList - 1;
  const batch = await queue.getJobs([bucket], 0, end, false);
  const jobs: QueueInspectionJobRow[] = [];
  for (const job of batch) {
    if (job == null || job.id == null) {
      continue;
    }
    const bullmqState = await queue.getJobState(String(job.id));
    if (!shouldEmitJobForSampleBucket(bucket, bullmqState)) {
      continue;
    }
    jobs.push(jobRowFromBullmqJob(queueName, bucket, bullmqState, job));
  }
  return jobs;
}

/**
 * BullMQ merges paused IDs into the `waiting` `getJobs` range; scan windows until we
 * collect `limit` jobs whose resolved state is actually `waiting`, or exhaust Redis.
 */
async function sampleTrueWaitingJobs(
  queue: Queue,
  queueName: VsQueueName,
  limit: number,
): Promise<QueueInspectionJobRow[]> {
  const jobs: QueueInspectionJobRow[] = [];
  let start = 0;
  const stride = Math.max(limit * 4, 40);
  while (jobs.length < limit && start <= WAITING_SAMPLE_MAX_START_OFFSET) {
    const batch = await queue.getJobs(["waiting"], start, start + stride - 1, false);
    if (batch.length === 0) {
      break;
    }
    for (const job of batch) {
      if (job == null || job.id == null) {
        continue;
      }
      const bullmqState = await queue.getJobState(String(job.id));
      if (bullmqState !== "waiting") {
        continue;
      }
      jobs.push(
        jobRowFromBullmqJob(queueName, "waiting", bullmqState, job),
      );
      if (jobs.length >= limit) {
        return jobs;
      }
    }
    start += stride;
  }
  return jobs;
}

export interface QueueInspectionJobRow {
  queueName: VsQueueName;
  /** Which `getJobs([bucket])` pass produced this row (may differ from `bullmqState`). */
  sampleFetchBucket: QueueInspectionSampleFetchBucket;
  /** Authoritative BullMQ/Redis state from `queue.getJobState(jobId)`. */
  bullmqState: string;
  id: string;
  name: string;
  attemptsMade: number;
  timestampIso: string | null;
  processedOnIso: string | null;
  finishedOnIso: string | null;
  failedReason: string | null;
  failedReasonTruncated: boolean;
  dataPreview: string;
  dataPreviewTruncated: boolean;
}

export function jobRowFromBullmqJob(
  queueName: VsQueueName,
  sampleFetchBucket: QueueInspectionSampleFetchBucket,
  bullmqState: string,
  job: Job,
): QueueInspectionJobRow {
  const idRaw = job.id;
  const id =
    idRaw === undefined || idRaw === null ? "unknown" : String(idRaw);
  const fr = job.failedReason ?? null;
  const frT = fr
    ? truncateForInspection(
        redactForLogLine(fr),
        QUEUE_INSPECTION_FAILED_REASON_MAX_CHARS,
      )
    : { text: "", truncated: false };
  const dataP = jsonPreviewForInspection(
    job.data,
    QUEUE_INSPECTION_DATA_PREVIEW_MAX_CHARS,
  );
  return {
    queueName,
    sampleFetchBucket,
    bullmqState,
    id,
    name: typeof job.name === "string" ? job.name : String(job.name),
    attemptsMade: job.attemptsMade ?? 0,
    timestampIso: formatIsoOrNull(job.timestamp),
    processedOnIso: formatIsoOrNull(job.processedOn ?? null),
    finishedOnIso: formatIsoOrNull(job.finishedOn ?? null),
    failedReason: fr ? frT.text : null,
    failedReasonTruncated: fr ? frT.truncated : false,
    dataPreview: dataP.preview,
    dataPreviewTruncated: dataP.truncated,
  };
}

export interface QueueInspectionSnapshot {
  queueName: VsQueueName;
  /** Raw BullMQ counts for this queue at `inspectedAt` (Redis source of truth). */
  counts: Record<string, number>;
  /**
   * When true for a sample bucket, that bucket’s Redis count exceeds
   * `jobSampleLimitPerList` (rows are a prefix only).
   */
  listTruncated: Record<QueueInspectionSampleFetchBucket, boolean>;
  jobs: QueueInspectionJobRow[];
}

export interface QueueInspectionReport {
  /** ISO time when Redis was queried; snapshot is point-in-time only. */
  inspectedAtIso: string;
  jobSampleLimitPerList: number;
  note: string;
  queues: QueueInspectionSnapshot[];
  queueErrors: { queueName: VsQueueName; message: string }[];
}

export interface InspectCanonicalVsQueuesOptions {
  jobSampleLimitPerList?: number;
}

/**
 * Opens each canonical VS queue, reads BullMQ job counts from Redis, and returns
 * capped job samples per fetch bucket. Resolves each sampled job’s true state via
 * `getJobState` so rows are not mislabeled when BullMQ merges lists internally.
 * Closes all queue handles before returning. Per-queue failures are captured in
 * `queueErrors` so other queues can still be inspected.
 */
export async function inspectCanonicalVsQueues(
  env: ServerEnv,
  options?: InspectCanonicalVsQueuesOptions,
): Promise<QueueInspectionReport> {
  const jobSampleLimitPerList =
    options?.jobSampleLimitPerList ?? QUEUE_INSPECTION_DEFAULT_JOB_SAMPLE_LIMIT;
  const inspectedAtIso = new Date().toISOString();
  const names = sortedCanonicalVsQueueNames();
  const queues: QueueInspectionSnapshot[] = [];
  const queueErrors: { queueName: VsQueueName; message: string }[] = [];
  const opened: Queue[] = [];

  try {
    for (const queueName of names) {
      const queue = new Queue(queueName, {
        connection: createBullMqRedisConnection(env),
      });
      opened.push(queue);
      try {
        await queue.waitUntilReady();
        const counts = await queue.getJobCounts();
        const listTruncated: Record<
          QueueInspectionSampleFetchBucket,
          boolean
        > = {
          waiting: false,
          paused: false,
          active: false,
          failed: false,
          completed: false,
          delayed: false,
          prioritized: false,
        };
        const jobs: QueueInspectionJobRow[] = [];

        for (const bucket of QUEUE_INSPECTION_SAMPLE_FETCH_BUCKETS) {
          const total = inspectionBucketCount(counts, bucket);
          if (total > jobSampleLimitPerList) {
            listTruncated[bucket] = true;
          }
          const sampled = await sampleJobsForBucket(
            queue,
            queueName,
            bucket,
            jobSampleLimitPerList,
          );
          jobs.push(...sampled);
        }

        queues.push({
          queueName,
          counts,
          listTruncated,
          jobs,
        });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        queueErrors.push({
          queueName,
          message: redactForLogLine(raw),
        });
      }
    }
  } finally {
    await Promise.all(
      opened.map(async (q) => {
        try {
          await q.close();
        } catch {
          /* closing best-effort */
        }
      }),
    );
  }

  return {
    inspectedAtIso,
    jobSampleLimitPerList,
    note:
      "Counts come from BullMQ/Redis at inspectedAt. Each job row includes sampleFetchBucket (which getJobs pass) and bullmqState from getJobState. Rows are capped per bucket; when listTruncated is true for a bucket, that bucket’s Redis count exceeds the sample limit. delayed, prioritized, and paused appear as their own buckets; the waiting pass only emits true waiting jobs so paused work is not mislabeled.",
    queues,
    queueErrors,
  };
}

/**
 * Parses `VS_QUEUE_INSPECT_JOB_SAMPLE_LIMIT` for operator scripts (optional).
 * Returns `undefined` when unset or invalid so callers can keep package default.
 */
export function parseQueueInspectJobSampleLimitFromEnv(
  raw: string | undefined,
): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const t = raw.trim();
  if (t === "") {
    return undefined;
  }
  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n) || n < 0) {
    return undefined;
  }
  return Math.min(n, QUEUE_INSPECTION_JOB_SAMPLE_LIMIT_HARD_CAP);
}
