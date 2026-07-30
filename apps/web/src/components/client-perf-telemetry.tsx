"use client";

import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { useEffect, useLayoutEffect, useRef } from "react";

function clientPerfEnabled(): boolean {
  return process.env.NEXT_PUBLIC_VS_CLIENT_PERF === "1";
}

function emitClientPerf(payload: Record<string, unknown>): void {
  if (!clientPerfEnabled()) {
    return;
  }
  console.info(
    JSON.stringify({
      vs_perf: true,
      category: "client",
      ts: new Date().toISOString(),
      ...payload,
    }),
  );
}

/**
 * Registers Web Vitals, navigation timing marks, and route-transition boundaries for dashboards.
 * Console emission is gated by `NEXT_PUBLIC_VS_CLIENT_PERF=1` so production stays quiet by default.
 */
export function ClientPerfTelemetry(): null {
  const pathname = usePathname();
  const prevPathKey = useRef<string | null>(null);

  useReportWebVitals((metric) => {
    emitClientPerf({
      event: "web_vital",
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      id: metric.id,
    });
  });

  /**
   * First `useEffect` after the RSC shell for this subtree. In typical App Router flows this
   * runs after the client has hydrated enough for effects to run; it is not a React-internal
   * hydration probe, so we label the contract explicitly in emitted payloads.
   */
  useEffect(() => {
    performance.mark("vs:first_client_effect");
    emitClientPerf({
      event: "client_boundary",
      boundary: "first_use_effect",
      semantics:
        "runs_after_ssr_shell_for_subtree_not_react_hydration_instrumentation",
    });
  }, []);

  useLayoutEffect(() => {
    performance.mark("vs:client_layout");
    const nav = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming | undefined;
    if (nav) {
      try {
        performance.measure("vs:initial_layout", {
          start: nav.responseStart,
          end: "vs:client_layout",
        });
      } catch {
        /* duplicate measure name on soft nav */
      }
    }
    emitClientPerf({
      event: "layout_commit",
    });
  }, []);

  useEffect(() => {
    const key = pathname ?? "";
    if (prevPathKey.current === null) {
      prevPathKey.current = key;
      performance.mark("vs:route_initial");
      emitClientPerf({ event: "route_initial", pathKey: key });
      return;
    }
    if (prevPathKey.current === key) {
      return;
    }
    performance.mark("vs:route_transition_start");
    prevPathKey.current = key;
    requestAnimationFrame(() => {
      performance.mark("vs:route_transition_paint");
      try {
        performance.measure("vs:route_transition", {
          start: "vs:route_transition_start",
          end: "vs:route_transition_paint",
        });
      } catch {
        /* marks missing if cleared */
      }
      emitClientPerf({ event: "route_transition", pathKey: key });
    });
  }, [pathname]);

  return null;
}
