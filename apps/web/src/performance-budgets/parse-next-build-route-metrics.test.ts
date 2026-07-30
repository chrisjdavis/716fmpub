import { describe, expect, it } from "vitest";
import { parseNextBuildRouteMetrics } from "./parse-next-build-route-metrics";

const sampleLog = `
Route (app)                                                Size  First Load JS
┌ ƒ /                                                   3.23 kB         109 kB
├ ƒ /_not-found                                           989 B         103 kB
├ ƒ /dashboard                                          2.13 kB         124 kB
├ ƒ /dashboard/archive                                  10.9 kB         116 kB
├ ƒ /dashboard/export                                   1.72 kB         107 kB
├ ƒ /dashboard/imports                                    188 B         122 kB
├ ƒ /dashboard/settings                                 3.52 kB         109 kB
+ First Load JS shared by all                            102 kB
  ├ chunks/18-556205eda2839723.js                       45.9 kB
ƒ Middleware                                            49.5 kB
`;

describe("parseNextBuildRouteMetrics", () => {
  it("extracts route first-load sizes, shared JS, and middleware", () => {
    const out = parseNextBuildRouteMetrics(sampleLog);
    expect(out.routes["/"]).toBe(109);
    expect(out.routes["/dashboard/archive"]).toBe(116);
    expect(out.routes["/dashboard/imports"]).toBe(122);
    expect(out.sharedFirstLoadKb).toBe(102);
    expect(out.middlewareKb).toBe(49.5);
  });
});
