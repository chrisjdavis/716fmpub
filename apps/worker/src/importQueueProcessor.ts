import { UnrecoverableError, type Job } from "bullmq";
import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import { getImportJobByIdForUser } from "@vs/db";
import { parseImportsWorkerJob, VsInvalidJobPayloadError } from "@vs/queue";

import { runBullMqMarkImportJobAndPipeline } from "./bullMqImportMarkRunPipeline.js";
import { runQueuedLastfmImport } from "./runQueuedLastfmImport.js";

function asInvalidPayloadFailure(err: unknown): UnrecoverableError {
  if (err instanceof VsInvalidJobPayloadError) {
    return new UnrecoverableError(err.message);
  }
  throw err;
}

export async function processImportsJob(
  job: Job,
  pool: Pool,
  env: ServerEnv,
): Promise<void> {
  let spec;
  try {
    spec = parseImportsWorkerJob(job);
  } catch (err) {
    throw asInvalidPayloadFailure(err);
  }

  const ids = { importJobId: spec.data.importJobId, userId: spec.data.userId };

  const ownedUserImport = await getImportJobByIdForUser(pool, {
    jobId: ids.importJobId,
    userId: ids.userId,
    source: "user",
  });
  if (!ownedUserImport) {
    throw new UnrecoverableError(
      `imports: no user-scoped import job for BullMQ job ${String(job.id)} (importJobId=${ids.importJobId}, userId=${ids.userId})`,
    );
  }

  await runBullMqMarkImportJobAndPipeline(job, pool, env, ids, {
    queueLabel: "imports",
    runPipeline: (p, e, row, trace) => runQueuedLastfmImport(p, e, row, trace),
  });
}
