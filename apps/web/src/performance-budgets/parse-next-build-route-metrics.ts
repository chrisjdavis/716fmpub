/**
 * Parses `next build` stdout for per-route First Load JS, shared bundle, and middleware weight.
 * Contract follows Next.js 15.5 table layout (tree + route + two trailing kB columns).
 */
export type ParsedNextRouteMetrics = {
  routes: Record<string, number>;
  sharedFirstLoadKb: number | null;
  middlewareKb: number | null;
};

/** Middle column is route chunk size (`kB` or `B`); last column is always First Load JS in `kB`. */
const routeLine =
  /^\s*[┌├└]\s*[ƒ○]\s+(\/[\S]*)\s+[\d.]+\s+(?:kB|B)\s+([\d.]+)\s+kB\s*$/;
const sharedLine = /^\+ First Load JS shared by all\s+([\d.]+)\s+kB/;
const middlewareLine = /^\s*ƒ Middleware\s+([\d.]+)\s+kB\s*$/;

export function parseNextBuildRouteMetrics(log: string): ParsedNextRouteMetrics {
  const routes: Record<string, number> = {};
  let sharedFirstLoadKb: number | null = null;
  let middlewareKb: number | null = null;

  for (const line of log.split(/\r?\n/)) {
    const routeMatch = line.match(routeLine);
    if (routeMatch) {
      const path = routeMatch[1];
      const kb = Number(routeMatch[2]);
      if (path && Number.isFinite(kb)) {
        routes[path] = kb;
      }
      continue;
    }
    const sharedMatch = line.match(sharedLine);
    if (sharedMatch) {
      const kb = Number(sharedMatch[1]);
      if (Number.isFinite(kb)) {
        sharedFirstLoadKb = kb;
      }
      continue;
    }
    const mwMatch = line.match(middlewareLine);
    if (mwMatch) {
      const kb = Number(mwMatch[1]);
      if (Number.isFinite(kb)) {
        middlewareKb = kb;
      }
    }
  }

  return { routes, sharedFirstLoadKb, middlewareKb };
}
