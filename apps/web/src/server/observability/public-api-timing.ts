import { runWithDbPerfContext } from "@vs/db";
import {
  emitApiRequestPerf,
  httpClassOutcome,
} from "@/server/observability/server-perf-log";

const TRACE_HEADER = "x-vs-trace" as const;

function readOrCreateTraceId(request: Request): string {
  const existing = request.headers.get(TRACE_HEADER)?.trim();
  if (existing) {
    return existing;
  }
  return crypto.randomUUID();
}

/**
 * DB perf context + structured wall timing for API routes that do not use `withApiSession`.
 */
export async function withPublicApiRouteTiming(
  req: Request,
  run: () => Promise<Response>,
): Promise<Response> {
  const routeLabel = `${req.method} ${new URL(req.url).pathname}`;
  const traceId = readOrCreateTraceId(req);
  return runWithDbPerfContext(
    { source: routeLabel, sourceKind: "api", traceId },
    async () => {
      const t0 = performance.now();
      try {
        const res = await run();
        const t1 = performance.now();
        emitApiRequestPerf({
          route: routeLabel,
          traceId,
          totalMs: Math.round((t1 - t0) * 1000) / 1000,
          outcome: httpClassOutcome(res.status),
          status: res.status,
        });
        return res;
      } catch (err) {
        const t1 = performance.now();
        emitApiRequestPerf({
          route: routeLabel,
          traceId,
          totalMs: Math.round((t1 - t0) * 1000) / 1000,
          outcome: "handler_threw",
        });
        throw err;
      }
    },
  );
}
