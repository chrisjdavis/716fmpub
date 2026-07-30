import { randomBytes } from "node:crypto";
import { UnrecoverableError, type Job } from "bullmq";
import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import {
  getExportJobByIdForUser,
  markExportJobCompleted,
  markExportJobFailed,
  tryMarkExportJobRunning,
} from "@vs/db";
import { parseExportsWorkerJob, VsInvalidJobPayloadError } from "@vs/queue";

import { generateListenExportZipFile } from "./listenExportZipGeneration.js";

function truncateExportErrorMessage(message: string): string {
  const max = 2000;
  return message.length <= max ? message : message.slice(0, max);
}

export async function processExportsJob(
  job: Job,
  pool: Pool,
  env: ServerEnv,
): Promise<void> {
  let spec;
  try {
    spec = parseExportsWorkerJob(job);
  } catch (err) {
    if (err instanceof VsInvalidJobPayloadError) {
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }
  const { exportJobId, userId } = spec.data;

  let row = await getExportJobByIdForUser(pool, { exportJobId, userId });
  if (!row) {
    throw new UnrecoverableError(
      `export job ${exportJobId} not found for user ${userId} (BullMQ job ${String(job.id)})`,
    );
  }
  if (row.stage === "completed" || row.stage === "expired") {
    return;
  }
  if (row.stage === "failed") {
    throw new UnrecoverableError(
      `export job ${exportJobId} is already failed (BullMQ job ${String(job.id)})`,
    );
  }
  if (row.stage === "queued") {
    const claimed = await tryMarkExportJobRunning(pool, { exportJobId, userId });
    if (claimed) {
      row = claimed;
    } else {
      const refreshed = await getExportJobByIdForUser(pool, { exportJobId, userId });
      if (!refreshed) {
        throw new UnrecoverableError(
          `export job ${exportJobId} disappeared after claim race (BullMQ job ${String(job.id)})`,
        );
      }
      if (refreshed.stage === "completed" || refreshed.stage === "expired") {
        return;
      }
      if (refreshed.stage === "failed") {
        throw new UnrecoverableError(
          `export job ${exportJobId} failed during claim race (BullMQ job ${String(job.id)})`,
        );
      }
      if (refreshed.stage !== "running") {
        throw new UnrecoverableError(
          `export job ${exportJobId} could not be claimed (stage=${refreshed.stage}, BullMQ job ${String(job.id)})`,
        );
      }
      row = refreshed;
    }
  } else if (row.stage !== "running") {
    throw new UnrecoverableError(
      `export job ${exportJobId} has unexpected stage=${row.stage} (BullMQ job ${String(job.id)})`,
    );
  }

  let zipWritten = false;
  try {
    const { artifactRelativePath, itemsProcessed } = await generateListenExportZipFile({
      pool,
      userId,
      exportJobId,
      format: row.format,
      artifactsBaseDir: env.EXPORT_ARTIFACTS_DIR,
      exportJobProgress: { exportJobId, userId },
    });
    zipWritten = true;
    const artifactDeliveryToken = randomBytes(32).toString("base64url");
    await markExportJobCompleted(pool, {
      exportJobId,
      userId,
      artifactRelativePath,
      artifactRetentionSeconds: env.EXPORT_ARTIFACT_RETENTION_SEC,
      finalItemsProcessed: itemsProcessed,
      artifactDeliveryToken,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const suffix = zipWritten
      ? " (ZIP written but completion update failed)"
      : "";
    await markExportJobFailed(pool, {
      exportJobId,
      userId,
      errorMessage: truncateExportErrorMessage(`${message}${suffix}`),
    });
    throw err;
  }
}
