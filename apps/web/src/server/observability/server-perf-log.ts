/**
 * Classifies completed handler responses for operator logs (never use `ok` for 4xx/5xx).
 */
export function httpClassOutcome(
  status: number,
):
  | "http_2xx"
  | "http_3xx"
  | "http_4xx"
  | "http_5xx"
  | "http_other" {
  if (status >= 200 && status < 300) {
    return "http_2xx";
  }
  if (status >= 300 && status < 400) {
    return "http_3xx";
  }
  if (status >= 400 && status < 500) {
    return "http_4xx";
  }
  if (status >= 500 && status < 600) {
    return "http_5xx";
  }
  return "http_other";
}

function readPerfSwitch(
  name: string,
  defaultOn: boolean,
): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === "0" || v === "off" || v === "false") {
    return false;
  }
  if (v === "1" || v === "on" || v === "true") {
    return true;
  }
  return defaultOn;
}

function emitPerfLine(payload: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      vs_perf: true,
      ts: new Date().toISOString(),
      ...payload,
    }),
  );
}

export function emitApiRequestPerf(payload: Record<string, unknown>): void {
  if (!readPerfSwitch("VS_PERF_API", true)) {
    return;
  }
  emitPerfLine({ category: "api_request", ...payload });
}

export function emitRscSegmentPerf(payload: Record<string, unknown>): void {
  if (!readPerfSwitch("VS_PERF_RSC", true)) {
    return;
  }
  emitPerfLine({ category: "rsc_segment", ...payload });
}
