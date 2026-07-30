import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emitApiRequestPerf,
  emitRscSegmentPerf,
  httpClassOutcome,
} from "./server-perf-log";

describe("server-perf-log", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    delete process.env.VS_PERF_API;
    delete process.env.VS_PERF_RSC;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits api_request lines by default", () => {
    emitApiRequestPerf({ route: "POST /api/auth/login", totalMs: 12, status: 200 });
    expect(console.log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(
      vi.mocked(console.log).mock.calls[0][0] as string,
    ) as Record<string, unknown>;
    expect(line.vs_perf).toBe(true);
    expect(line.category).toBe("api_request");
    expect(line.route).toBe("POST /api/auth/login");
  });

  it("respects VS_PERF_API=off", () => {
    process.env.VS_PERF_API = "off";
    emitApiRequestPerf({ route: "GET /x", totalMs: 1 });
    expect(console.log).not.toHaveBeenCalled();
  });

  it("classifies HTTP outcomes without using ok for error statuses", () => {
    expect(httpClassOutcome(200)).toBe("http_2xx");
    expect(httpClassOutcome(401)).toBe("http_4xx");
    expect(httpClassOutcome(503)).toBe("http_5xx");
  });

  it("emits rsc_segment lines by default", () => {
    emitRscSegmentPerf({ segment: "dashboard_tree", totalMs: 40 });
    const line = JSON.parse(
      vi.mocked(console.log).mock.calls[0][0] as string,
    ) as Record<string, unknown>;
    expect(line.category).toBe("rsc_segment");
  });
});
