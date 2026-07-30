import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import { enqueueLayer1EvidenceRecomputeForUserBestEffort } from "@vs/db";

/**
 * After background `system_sync` ingest materializes new canonical listens, best-effort
 * enqueue Layer 1 evidence recompute. Core accounts are skipped inside
 * {@link enqueueLayer1EvidenceRecomputeForUserBestEffort}. Does not compute Layer 1 inline.
 *
 * Listen sync is already spaced per user via `LISTEN_SYNC_USER_MIN_INTERVAL_SEC`; combined
 * with stable per-user BullMQ `jobId` for `layer1_evidence_recompute`, routine scrobbling
 * does not publish unbounded duplicate jobs.
 */
export async function enqueueLayer1AfterMeaningfulListenIngestion(
  pool: Pool,
  env: ServerEnv,
  userId: string,
  input: Readonly<{ canonicalizedNewListenRows: number }>,
): Promise<void> {
  if (input.canonicalizedNewListenRows <= 0) {
    return;
  }
  await enqueueLayer1EvidenceRecomputeForUserBestEffort({
    env,
    db: pool,
    userId,
    reason: "listen_ingested",
  });
}
