import type { DashboardAnalyticsDbExecutor } from "./dashboardAnalytics.js";

export type Layer1SignalRunStatus = "running" | "succeeded" | "failed" | "cancelled";

export type InsertLayer1SignalRunRunningInput = Readonly<{
  triggerKind: string;
  correlationId?: string | null;
  actorUserId?: string | null;
  contextJson: unknown;
}>;

/**
 * Opens a `layer1_signal_runs` row in `running` for provenance (VS-50).
 * Callers must {@link finalizeLayer1SignalRun} on all paths.
 */
export async function insertLayer1SignalRunRunning(
  db: DashboardAnalyticsDbExecutor,
  input: InsertLayer1SignalRunRunningInput,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into layer1_signal_runs (
       status,
       trigger_kind,
       correlation_id,
       actor_user_id,
       context_json
     ) values (
       'running',
       $1,
       $2,
       $3::uuid,
       $4::jsonb
     )
     returning id::text as id`,
    [
      input.triggerKind,
      input.correlationId ?? null,
      input.actorUserId ?? null,
      JSON.stringify(input.contextJson ?? {}),
    ],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error("insertLayer1SignalRunRunning: missing returning id");
  }
  return id;
}

export type FinalizeLayer1SignalRunInput = Readonly<{
  runId: string;
  status: Exclude<Layer1SignalRunStatus, "running">;
  errorCode?: string | null;
  errorDetail?: string | null;
}>;

export async function finalizeLayer1SignalRun(
  db: DashboardAnalyticsDbExecutor,
  input: FinalizeLayer1SignalRunInput,
): Promise<void> {
  await db.query(
    `update layer1_signal_runs
        set status = $2,
            completed_at = now(),
            error_code = $3,
            error_detail = $4
      where id = $1::uuid
        and status = 'running'`,
    [
      input.runId,
      input.status,
      input.errorCode ?? null,
      input.errorDetail != null && input.errorDetail.length > 4000
        ? `${input.errorDetail.slice(0, 3990)}…[truncated]`
        : input.errorDetail ?? null,
    ],
  );
}
