import type { Job, JobType, Queue } from "bullmq";

const USER_JOB_STATES = [
  "waiting",
  "delayed",
  "prioritized",
  "paused",
  "waiting-children",
  "active",
] as const satisfies readonly JobType[];

export type RemoveUserJobsResult = Readonly<{
  inspected: number;
  removed: number;
  notRemoved: number;
}>;

function jobBelongsToUser(job: Job, userId: string): boolean {
  const data = job.data;
  return (
    data !== null &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    (data as { userId?: unknown }).userId === userId
  );
}

/**
 * Best-effort Redis cleanup for destructive account deletion. Waiting/delayed
 * jobs are removable; active jobs may be locked by a worker and are reported
 * through `notRemoved` so callers can block deletion until work settles.
 */
export async function removeUserJobsFromQueue(
  queue: Queue,
  userId: string,
): Promise<RemoveUserJobsResult> {
  let inspected = 0;
  let removed = 0;
  let notRemoved = 0;
  const seen = new Set<string>();

  for (const state of USER_JOB_STATES) {
    const jobs = await queue.getJobs([state], 0, 999, false);
    for (const job of jobs) {
      const key = String(job.id ?? `${state}:${inspected}`);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      inspected += 1;
      if (!jobBelongsToUser(job, userId)) {
        continue;
      }
      try {
        await job.remove();
        removed += 1;
      } catch {
        notRemoved += 1;
      }
    }
  }

  return { inspected, removed, notRemoved };
}
