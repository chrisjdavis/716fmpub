import type { Job, JobsOptions, Queue } from "bullmq";

import { defaultImportsJobOptions } from "./imports-job-bullmq-options.js";
import { defaultIncrementalSyncJobOptions } from "./incremental-sync-job-bullmq-options.js";
import {
  validateAnalyticsJobSpec,
  type AnalyticsJobSpec,
  type ParsedAnalyticsWorkerJob,
  validateExportsJobSpec,
  type ExportsJobSpec,
  validateImportsJobSpec,
  type ImportsJobSpec,
  validateIncrementalSyncJobSpec,
  type IncrementalSyncJobSpec,
  validateSyncJobSpec,
  type SyncJobSpec,
} from "./job-contracts.js";
import {
  extractSafeJobDataFields,
  logQueueActivity,
  summarizeFailure,
} from "./queue-structured-log.js";

/**
 * Enqueue on `imports` after Zod validation. Rejects unknown job names and
 * malformed payloads — callers must not bypass with raw `queue.add`.
 */
export async function enqueueImportsJob(
  queue: Queue,
  spec: ImportsJobSpec,
  jobsOptions?: JobsOptions,
): Promise<Job> {
  const qn = queue.name;
  let name: string;
  let data: ImportsJobSpec["data"];
  try {
    const v = validateImportsJobSpec(spec);
    name = v.name;
    data = v.data;
  } catch (err) {
    logQueueActivity({
      level: "warn",
      event: "enqueue_validation_failed",
      queue: qn,
      jobName: spec.name,
      ...extractSafeJobDataFields(spec.data),
      failure: summarizeFailure(err),
    });
    throw err;
  }
  const merged: JobsOptions = {
    ...defaultImportsJobOptions(),
    /** Stable id so duplicate publishes across instances collapse in Redis (BullMQ). */
    jobId: data.importJobId,
    ...jobsOptions,
  };
  try {
    const added = await queue.add(name, data, merged);
    logQueueActivity({
      level: "info",
      event: "enqueue_ok",
      queue: qn,
      bullmqJobId: String(added.id),
      jobName: name,
      userId: data.userId,
      importJobId: data.importJobId,
    });
    return added;
  } catch (err) {
    logQueueActivity({
      level: "error",
      event: "enqueue_redis_failed",
      queue: qn,
      jobName: name,
      userId: data.userId,
      importJobId: data.importJobId,
      failure: summarizeFailure(err),
    });
    throw err;
  }
}

/** Enqueue on `exports` with a validated payload. */
export async function enqueueExportsJob(
  queue: Queue,
  spec: ExportsJobSpec,
  jobsOptions?: JobsOptions,
): Promise<Job> {
  const qn = queue.name;
  let name: string;
  let data: ExportsJobSpec["data"];
  try {
    const v = validateExportsJobSpec(spec);
    name = v.name;
    data = v.data;
  } catch (err) {
    logQueueActivity({
      level: "warn",
      event: "enqueue_validation_failed",
      queue: qn,
      jobName: spec.name,
      ...extractSafeJobDataFields(spec.data),
      failure: summarizeFailure(err),
    });
    throw err;
  }
  try {
    const added = await queue.add(name, data, jobsOptions);
    logQueueActivity({
      level: "info",
      event: "enqueue_ok",
      queue: qn,
      bullmqJobId: String(added.id),
      jobName: name,
      userId: data.userId,
      exportJobId: data.exportJobId,
    });
    return added;
  } catch (err) {
    logQueueActivity({
      level: "error",
      event: "enqueue_redis_failed",
      queue: qn,
      jobName: name,
      userId: data.userId,
      exportJobId: data.exportJobId,
      failure: summarizeFailure(err),
    });
    throw err;
  }
}

/** Enqueue on `analytics` with a validated payload. */
export async function enqueueAnalyticsJob(
  queue: Queue,
  spec: AnalyticsJobSpec,
  jobsOptions?: JobsOptions,
): Promise<Job> {
  const qn = queue.name;
  let name: string;
  let data: ParsedAnalyticsWorkerJob["data"];
  try {
    const v = validateAnalyticsJobSpec(spec);
    name = v.name;
    data = v.data;
  } catch (err) {
    logQueueActivity({
      level: "warn",
      event: "enqueue_validation_failed",
      queue: qn,
      jobName: spec.name,
      ...extractSafeJobDataFields(spec.data),
      failure: summarizeFailure(err),
    });
    throw err;
  }
  try {
    const added = await queue.add(name, data, jobsOptions);
    logQueueActivity({
      level: "info",
      event: "enqueue_ok",
      queue: qn,
      bullmqJobId: String(added.id),
      jobName: name,
      ...extractSafeJobDataFields(data),
    });
    return added;
  } catch (err) {
    logQueueActivity({
      level: "error",
      event: "enqueue_redis_failed",
      queue: qn,
      jobName: name,
      ...extractSafeJobDataFields(data),
      failure: summarizeFailure(err),
    });
    throw err;
  }
}

/** Enqueue on `sync` with a validated payload. */
export async function enqueueSyncJob(
  queue: Queue,
  spec: SyncJobSpec,
  jobsOptions?: JobsOptions,
): Promise<Job> {
  const qn = queue.name;
  let name: string;
  let data: SyncJobSpec["data"];
  try {
    const v = validateSyncJobSpec(spec);
    name = v.name;
    data = v.data;
  } catch (err) {
    logQueueActivity({
      level: "warn",
      event: "enqueue_validation_failed",
      queue: qn,
      jobName: spec.name,
      ...extractSafeJobDataFields(spec.data),
      failure: summarizeFailure(err),
    });
    throw err;
  }
  try {
    const added = await queue.add(name, data, jobsOptions);
    logQueueActivity({
      level: "info",
      event: "enqueue_ok",
      queue: qn,
      bullmqJobId: String(added.id),
      jobName: name,
      userId: data.userId,
      detail: { trigger: data.trigger },
    });
    return added;
  } catch (err) {
    logQueueActivity({
      level: "error",
      event: "enqueue_redis_failed",
      queue: qn,
      jobName: name,
      userId: data.userId,
      detail: { trigger: data.trigger },
      failure: summarizeFailure(err),
    });
    throw err;
  }
}

/** Enqueue on `incremental_sync` with a validated payload and stable BullMQ `jobId`. */
export async function enqueueIncrementalSyncJob(
  queue: Queue,
  spec: IncrementalSyncJobSpec,
  jobsOptions?: JobsOptions,
): Promise<Job> {
  const qn = queue.name;
  let name: string;
  let data: IncrementalSyncJobSpec["data"];
  try {
    const v = validateIncrementalSyncJobSpec(spec);
    name = v.name;
    data = v.data;
  } catch (err) {
    logQueueActivity({
      level: "warn",
      event: "enqueue_validation_failed",
      queue: qn,
      jobName: spec.name,
      ...extractSafeJobDataFields(spec.data),
      failure: summarizeFailure(err),
    });
    throw err;
  }
  const merged: JobsOptions = {
    ...defaultIncrementalSyncJobOptions(),
    jobId: data.importJobId,
    ...jobsOptions,
  };
  try {
    const added = await queue.add(name, data, merged);
    logQueueActivity({
      level: "info",
      event: "enqueue_ok",
      queue: qn,
      bullmqJobId: String(added.id),
      jobName: name,
      userId: data.userId,
      importJobId: data.importJobId,
    });
    return added;
  } catch (err) {
    logQueueActivity({
      level: "error",
      event: "enqueue_redis_failed",
      queue: qn,
      jobName: name,
      userId: data.userId,
      importJobId: data.importJobId,
      failure: summarizeFailure(err),
    });
    throw err;
  }
}
