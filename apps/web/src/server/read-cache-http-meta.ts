import { NextResponse } from "next/server";
import type { ReadCacheTelemetryEntry } from "@/server/user-scoped-ttl-read-cache";

export function attachReadCacheHttpMeta(
  res: NextResponse,
  entries: readonly ReadCacheTelemetryEntry[],
): void {
  if (entries.length === 0) {
    return;
  }
  res.headers.set(
    "X-VS-Read-Cache",
    entries.map((e) => `${e.namespace}:${e.served_from}`).join(","),
  );
  res.headers.set(
    "X-VS-Read-Cache-Max-Stale-Sec",
    String(Math.max(...entries.map((e) => e.max_stale_seconds))),
  );
}
