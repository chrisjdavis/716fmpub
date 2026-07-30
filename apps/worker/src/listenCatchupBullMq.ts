import type { ListenCatchupEnqueueResult } from "@vs/db";
import { UnrecoverableError } from "bullmq";

/**
 * BullMQ must not report success when the database declined to enqueue a
 * `system_sync` row — operators rely on failed job state, not only stdout.
 */
export function throwIfListenCatchupNotEnqueued(
  out: ListenCatchupEnqueueResult,
  ctx: { bullmqJobId: string; userId: string; trigger: string },
): asserts out is { ok: true; importJobId: string } {
  if (out.ok) {
    return;
  }
  throw new UnrecoverableError(
    `[vs-sync] listen_catchup job=${ctx.bullmqJobId} userId=${ctx.userId} trigger=${ctx.trigger}: not enqueued (${out.reason})`,
  );
}
