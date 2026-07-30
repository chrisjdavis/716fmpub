"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

/**
 * When `NEXT_PUBLIC_VS_CLIENT_PERF` is unset, telemetry is optional noise reduction: this wrapper
 * lives in a Client Component so `next/dynamic` may use `ssr: false` (disallowed in RSC in Next 15.5+).
 * When profiling is enabled, the dashboard layout imports {@link ClientPerfTelemetry} directly so
 * Web Vitals and marks register on the normal client timeline.
 */
const LazyClientPerfTelemetry = dynamic(
  () =>
    import("@/components/client-perf-telemetry").then((m) => ({
      default: m.ClientPerfTelemetry,
    })),
  { ssr: false },
);

export function DeferredClientPerfTelemetry(): ReactNode {
  return <LazyClientPerfTelemetry />;
}
