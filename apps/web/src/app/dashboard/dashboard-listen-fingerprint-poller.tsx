"use client";

import { LISTEN_FINGERPRINT_POLL_MS } from "@vs/domain/listen-fingerprint-poll";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { dispatchListenDataInvalidation } from "./listen-data-invalidation";
import { createListenRefreshCoalescer } from "./listen-refresh-coalesce";
import { pathnameAcceptsListenCoalescedRefresh } from "./listen-refresh-pathname";

function clientPerfEnabled(): boolean {
  return process.env.NEXT_PUBLIC_VS_CLIENT_PERF === "1";
}

function emitListenClientPerf(payload: Record<string, unknown>): void {
  if (!clientPerfEnabled()) {
    return;
  }
  console.info(
    JSON.stringify({
      vs_perf: true,
      category: "client_listen_transport",
      ts: new Date().toISOString(),
      ...payload,
    }),
  );
}

function isRealtimeHandshake(
  x: unknown,
): x is { enabled: true; wsUrl: string; token: string } {
  if (!x || typeof x !== "object") {
    return false;
  }
  const o = x as Record<string, unknown>;
  return (
    o.enabled === true &&
    typeof o.wsUrl === "string" &&
    o.wsUrl.length > 0 &&
    typeof o.token === "string" &&
    o.token.length > 0
  );
}

/**
 * Trailing debounce after the last invalidation; merges NOTIFY storms into one navigation
 * refresh. {@link LISTEN_REFRESH_MAX_WAIT_MS} caps worst-case delay while signals never stop.
 */
const LISTEN_REFRESH_TRAILING_DEBOUNCE_MS = 320;
const LISTEN_REFRESH_MAX_WAIT_MS = 1400;

/**
 * Prefers WebSocket push (Postgres NOTIFY → `realtime` app) with HTTP fingerprint polling as
 * fallback when realtime is disabled or the socket is down.
 */
export function DashboardListenFingerprintPoller() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const lastFingerprint = useRef<string | null>(null);
  const [, startTransition] = useTransition();
  const wsSignalTally = useRef(0);
  const fingerprintSignalTally = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const coalescer = createListenRefreshCoalescer(
      {
        trailingDebounceMs: LISTEN_REFRESH_TRAILING_DEBOUNCE_MS,
        maxWaitMs: LISTEN_REFRESH_MAX_WAIT_MS,
      },
      (meta) => {
        const wsN = wsSignalTally.current;
        const fpN = fingerprintSignalTally.current;
        performance.mark("vs:dashboard_listen_refresh_start");
        const pathOk = pathnameAcceptsListenCoalescedRefresh(pathnameRef.current);
        startTransition(() => {
          if (pathOk) {
            router.refresh();
          }
        });
        if (pathOk) {
          dispatchListenDataInvalidation();
        }
        requestAnimationFrame(() => {
          performance.mark("vs:dashboard_listen_refresh_after_paint");
          try {
            performance.measure("vs:dashboard_listen_refresh", {
              start: "vs:dashboard_listen_refresh_start",
              end: "vs:dashboard_listen_refresh_after_paint",
            });
          } catch {
            /* ignore */
          }
          emitListenClientPerf({
            event: "dashboard_listen_coalesced_refresh",
            coalesced_signal_count: meta.signalCount,
            flush_reason: meta.flushReason,
            websocket_invalidation_signals: wsN,
            fingerprint_poll_invalidation_signals: fpN,
          });
          wsSignalTally.current = 0;
          fingerprintSignalTally.current = 0;
          if (fpN > 0) {
            emitListenClientPerf({ event: "fingerprint_refresh" });
          }
          if (wsN > 0) {
            emitListenClientPerf({ event: "ws_listens_updated_refresh" });
          }
        });
      },
    );

    function requestCoalescedRouterRefresh(source: "websocket" | "fingerprint_poll") {
      if (source === "websocket") {
        wsSignalTally.current += 1;
      } else {
        fingerprintSignalTally.current += 1;
      }
      coalescer.request();
    }

    async function fingerprintPull() {
      const res = await fetch("/api/me/listen-fingerprint", {
        credentials: "include",
      });
      if (cancelled || !res.ok) {
        return;
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        return;
      }
      if (!json || typeof json !== "object") {
        return;
      }
      const fp = JSON.stringify(json);
      if (lastFingerprint.current !== null && lastFingerprint.current !== fp) {
        requestCoalescedRouterRefresh("fingerprint_poll");
      }
      lastFingerprint.current = fp;
    }

    function startPolling() {
      if (pollTimer !== null) {
        return;
      }
      void fingerprintPull();
      pollTimer = setInterval(() => void fingerprintPull(), LISTEN_FINGERPRINT_POLL_MS);
    }

    function stopPolling() {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function clearReconnect() {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function scheduleWsReconnect(attempt: number) {
      clearReconnect();
      const delay = Math.min(30_000, 500 * 2 ** Math.min(attempt, 8));
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void openRealtimeSocket(attempt + 1);
      }, delay);
    }

    async function openRealtimeSocket(attempt: number) {
      if (cancelled) {
        return;
      }
      const res = await fetch("/api/me/listen-realtime", { credentials: "include" });
      if (cancelled || !res.ok) {
        startPolling();
        return;
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        startPolling();
        return;
      }
      if (!isRealtimeHandshake(json)) {
        startPolling();
        return;
      }

      stopPolling();
      clearReconnect();

      try {
        ws = new WebSocket(json.wsUrl);
      } catch {
        startPolling();
        scheduleWsReconnect(attempt);
        return;
      }

      const token = json.token;
      ws.onopen = () => {
        performance.mark("vs:ws_socket_open");
        ws?.send(JSON.stringify({ type: "auth", token }));
      };
      ws.onmessage = (ev) => {
        let msg: unknown;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (!msg || typeof msg !== "object") {
          return;
        }
        const typ = (msg as Record<string, unknown>).type;
        if (typ === "ready") {
          performance.mark("vs:ws_ready");
          emitListenClientPerf({ event: "ws_ready" });
          if (pathnameAcceptsListenCoalescedRefresh(pathnameRef.current)) {
            dispatchListenDataInvalidation();
          }
          return;
        }
        if (typ === "listens_updated") {
          const recv = performance.now();
          const vsEventId = (msg as Record<string, unknown>)["vs_event_id"];
          emitListenClientPerf({
            event: "ws_listens_updated",
            vs_event_id:
              typeof vsEventId === "string" && vsEventId.length > 0
                ? vsEventId
                : null,
            sinceReadyMarkMs: (() => {
              try {
                const e = performance.getEntriesByName(
                  "vs:ws_ready",
                  "mark",
                )[0];
                return e ? recv - e.startTime : null;
              } catch {
                return null;
              }
            })(),
          });
          requestCoalescedRouterRefresh("websocket");
        }
      };
      ws.onerror = () => {
        ws?.close();
      };
      ws.onclose = () => {
        ws = null;
        startPolling();
        if (!cancelled) {
          scheduleWsReconnect(attempt);
        }
      };
    }

    // Avoid racing `GET /api/me/listen-fingerprint` against the realtime handshake on mount;
    // fingerprint polling starts from `startPolling()` when HTTP/WS setup falls back.
    // Operator note: `lastFingerprint` is not primed until polling runs; WebSocket `listens_updated`
    // remains the primary invalidation path when realtime is enabled.

    void openRealtimeSocket(0);

    return () => {
      cancelled = true;
      coalescer.dispose();
      clearReconnect();
      if (ws !== null) {
        ws.close();
        ws = null;
      }
      stopPolling();
    };
  }, [router]);

  return null;
}
