import type { Pool, PoolClient, QueryResult } from "pg";
import { getDbPerfContext } from "./db-perf-context.js";

const instrumentedPools = new WeakSet<Pool>();
const instrumentedClients = new WeakSet<PoolClient>();

type DbQueryLogMode = "off" | "slow" | "all";

const SLOW_QUERY_MS = 100;

function readDbQueryLogMode(): DbQueryLogMode {
  const raw = process.env.VS_PERF_DB_QUERIES?.trim().toLowerCase();
  if (raw === "0" || raw === "off" || raw === "false") {
    return "off";
  }
  if (raw === "2" || raw === "all" || raw === "verbose") {
    return "all";
  }
  if (raw === "1" || raw === "slow") {
    return "slow";
  }
  return process.env.NODE_ENV === "production" ? "slow" : "all";
}

function emitDbQueryLine(payload: Record<string, unknown>): void {
  const line = JSON.stringify({
    vs_perf: true,
    category: "db_query",
    ts: new Date().toISOString(),
    ...payload,
  });
  console.log(line);
}

function shouldEmitQuery(durationMs: number, mode: DbQueryLogMode): boolean {
  if (mode === "off") {
    return false;
  }
  if (mode === "all") {
    return true;
  }
  return durationMs >= SLOW_QUERY_MS;
}

function sqlTextLen(args: unknown[]): number | null {
  const textArg = args[0];
  if (typeof textArg === "string") {
    return textArg.length;
  }
  if (textArg && typeof textArg === "object" && "text" in textArg) {
    return String((textArg as { text?: string }).text ?? "").length;
  }
  return null;
}

function logFinishedQueryWithArgs(
  mode: DbQueryLogMode,
  t0: number,
  args: unknown[],
  result: QueryResult | undefined,
  error: boolean,
): void {
  const durationMs = Math.round((performance.now() - t0) * 1000) / 1000;
  if (!shouldEmitQuery(durationMs, mode)) {
    return;
  }
  const ctx = getDbPerfContext();
  emitDbQueryLine({
    durationMs,
    rowCount: result?.rowCount ?? null,
    command: result?.command ?? null,
    error,
    textLen: sqlTextLen(args),
    dbSource: ctx?.source ?? null,
    dbSourceKind: ctx?.sourceKind ?? "unattributed",
    traceId: ctx?.traceId ?? null,
    unattributed: ctx === undefined,
  });
}

function wrapPoolQuery(pool: Pool): void {
  if (typeof pool.query !== "function") {
    return;
  }
  const origPoolQuery = pool.query.bind(pool) as (
    this: Pool,
    ...args: unknown[]
  ) => unknown;
  pool.query = function poolQueryInstrumented(
    this: Pool,
    ...args: unknown[]
  ): unknown {
    const mode = readDbQueryLogMode();
    if (mode === "off") {
      return origPoolQuery.apply(this, args);
    }
    const t0 = performance.now();
    const out = origPoolQuery.apply(this, args) as
      | Promise<QueryResult>
      | QueryResult;
    if (out && typeof (out as Promise<QueryResult>).then === "function") {
      return (out as Promise<QueryResult>)
        .then((res) => {
          logFinishedQueryWithArgs(mode, t0, args, res, false);
          return res;
        })
        .catch((err) => {
          logFinishedQueryWithArgs(mode, t0, args, undefined, true);
          throw err;
        });
    }
    try {
      logFinishedQueryWithArgs(mode, t0, args, out as QueryResult, false);
    } catch {
      /* ignore */
    }
    return out;
  } as unknown as Pool["query"];
}

function wrapClientQuery(client: PoolClient): void {
  if (instrumentedClients.has(client)) {
    return;
  }
  instrumentedClients.add(client);
  const orig = client.query.bind(client) as (
    this: PoolClient,
    ...args: unknown[]
  ) => unknown;
  client.query = function clientQueryInstrumented(
    this: PoolClient,
    ...args: unknown[]
  ): unknown {
    const mode = readDbQueryLogMode();
    if (mode === "off") {
      return orig.apply(this, args);
    }
    const t0 = performance.now();
    const out = orig.apply(this, args) as Promise<QueryResult> | QueryResult;
    if (out && typeof (out as Promise<QueryResult>).then === "function") {
      return (out as Promise<QueryResult>)
        .then((res) => {
          logFinishedQueryWithArgs(mode, t0, args, res, false);
          return res;
        })
        .catch((err) => {
          logFinishedQueryWithArgs(mode, t0, args, undefined, true);
          throw err;
        });
    }
    try {
      logFinishedQueryWithArgs(mode, t0, args, out as QueryResult, false);
    } catch {
      /* ignore */
    }
    return out;
  } as unknown as PoolClient["query"];
}

/**
 * Wraps `pool.query` and `PoolClient.query` for clients acquired via `pool.connect()`.
 * Emits one JSON log line per query when `VS_PERF_DB_QUERIES` allows it.
 * Never logs SQL text or bind parameters.
 */
export function ensurePoolQueryInstrumentation(pool: Pool): void {
  if (instrumentedPools.has(pool)) {
    return;
  }
  instrumentedPools.add(pool);
  wrapPoolQuery(pool);
  if (typeof pool.connect !== "function") {
    return;
  }
  const origConnect = pool.connect.bind(pool) as (
    this: Pool,
    ...args: unknown[]
  ) => unknown;
  pool.connect = function connectInstrumented(
    this: Pool,
    ...args: unknown[]
  ): unknown {
    const out = origConnect.apply(this, args);
    if (out && typeof (out as Promise<PoolClient>).then === "function") {
      return (out as Promise<PoolClient>).then((c) => {
        wrapClientQuery(c);
        return c;
      });
    }
    return out;
  } as unknown as Pool["connect"];
}
