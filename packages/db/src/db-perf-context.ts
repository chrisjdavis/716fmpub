import { AsyncLocalStorage } from "node:async_hooks";

export type DbPerfSourceKind =
  | "api"
  | "rsc"
  | "job"
  | "realtime"
  | "unattributed";

export type DbPerfContext = {
  /** Logical owner of DB work (route template, RSC segment, job name, etc.). */
  source: string;
  sourceKind: DbPerfSourceKind;
  /** Correlates DB lines with API/RSC/job logs when set (e.g. `x-vs-trace` from edge middleware). */
  traceId?: string;
};

const store = new AsyncLocalStorage<DbPerfContext>();

export function runWithDbPerfContext<T>(
  ctx: DbPerfContext,
  fn: () => Promise<T>,
): Promise<T> {
  return store.run(ctx, fn);
}

export function getDbPerfContext(): DbPerfContext | undefined {
  return store.getStore();
}
