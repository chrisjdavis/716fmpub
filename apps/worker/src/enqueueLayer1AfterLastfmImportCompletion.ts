import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import { enqueueLayer1EvidenceRecomputeForUserBestEffort } from "@vs/db";

/**
 * After a user-sourced (`import_jobs.source = 'user'`) Last.fm import reaches `completed`,
 * enqueue Layer 1 evidence recompute. Advanced accounts publish a BullMQ job; Core is
 * skipped inside {@link enqueueLayer1EvidenceRecomputeForUserBestEffort}. Does not compute
 * signals on the import thread.
 */
export async function enqueueLayer1AfterLastfmImportCompletion(
  pool: Pool,
  env: ServerEnv,
  userId: string,
): Promise<void> {
  await enqueueLayer1EvidenceRecomputeForUserBestEffort({
    env,
    db: pool,
    userId,
    reason: "import_completed",
  });
}
