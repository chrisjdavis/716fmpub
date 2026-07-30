import { randomUUID } from "node:crypto";
import { loadServerEnv } from "@vs/env";
import { verifyListenRealtimeToken } from "@vs/realtime-token";
import { summarizeThrowableForLog } from "@vs/sensitive";
import { Client } from "pg";
import { WebSocket, WebSocketServer } from "ws";
import {
  buildListensUpdatedFrame,
  buildReadyFrame,
} from "./listen-realtime-wire-format.js";

const NOTIFY_CHANNEL = "listen_change" as const;

/** Trailing debounce for per-user WS fan-out (pairs with statement-level NOTIFY coalesce). */
const BROADCAST_TRAILING_MS = 75;
/** Max wait from first signal in a burst before forcing a fan-out. */
const BROADCAST_MAX_WAIT_MS = 400;
/** Delay before reconnecting the Postgres LISTEN client after an error. */
const PG_RECONNECT_BASE_MS = 500;
const PG_RECONNECT_MAX_MS = 30_000;

type AuthedSocket = WebSocket & { userId?: string };

function parseNotifyPayload(raw: string): { userId: string } | null {
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") {
      return null;
    }
    const id = (o as Record<string, unknown>)["user_id"];
    return typeof id === "string" && id.length > 0 ? { userId: id } : null;
  } catch {
    return null;
  }
}

function main(): void {
  const env = loadServerEnv();
  const secret = env.REALTIME_JWT_SECRET;
  if (!secret) {
    console.error(
      "[realtime] REALTIME_JWT_SECRET is not set; refusing to start (no auth).",
    );
    process.exit(1);
  }

  const port = env.LISTEN_REALTIME_PORT;
  const wss = new WebSocketServer({ port });
  const rooms = new Map<string, Set<AuthedSocket>>();

  type CoalesceState = {
    trailingTimer: ReturnType<typeof setTimeout> | null;
    maxWaitTimer: ReturnType<typeof setTimeout> | null;
    pending: number;
  };
  const coalesceByUser = new Map<string, CoalesceState>();

  function addToRoom(userId: string, ws: AuthedSocket): void {
    let set = rooms.get(userId);
    if (!set) {
      set = new Set();
      rooms.set(userId, set);
    }
    set.add(ws);
  }

  function removeFromRoom(userId: string, ws: AuthedSocket): void {
    const set = rooms.get(userId);
    if (!set) {
      return;
    }
    set.delete(ws);
    if (set.size === 0) {
      rooms.delete(userId);
    }
  }

  function emitRealtimePerf(payload: Record<string, unknown>): void {
    const off = process.env.VS_PERF_REALTIME?.trim().toLowerCase();
    if (off === "0" || off === "off" || off === "false") {
      return;
    }
    console.log(
      JSON.stringify({
        vs_perf: true,
        category: "realtime",
        ts: new Date().toISOString(),
        ...payload,
      }),
    );
  }

  function fanoutNow(userId: string): void {
    const set = rooms.get(userId);
    if (!set) {
      return;
    }
    const t0 = performance.now();
    const vsEventId = randomUUID();
    const msg = buildListensUpdatedFrame(vsEventId);
    let sent = 0;
    for (const client of set) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
        sent += 1;
      }
    }
    const fanoutMs = Math.round((performance.now() - t0) * 1000) / 1000;
    emitRealtimePerf({
      event: "listens_fanout",
      vs_event_id: vsEventId,
      roomSize: set.size,
      openSent: sent,
      fanoutMs,
    });
  }

  function scheduleBroadcast(userId: string): void {
    let state = coalesceByUser.get(userId);
    if (!state) {
      state = { trailingTimer: null, maxWaitTimer: null, pending: 0 };
      coalesceByUser.set(userId, state);
    }
    state.pending += 1;

    if (state.trailingTimer !== null) {
      clearTimeout(state.trailingTimer);
    }
    state.trailingTimer = setTimeout(() => {
      const cur = coalesceByUser.get(userId);
      if (!cur) {
        return;
      }
      if (cur.maxWaitTimer !== null) {
        clearTimeout(cur.maxWaitTimer);
      }
      coalesceByUser.delete(userId);
      fanoutNow(userId);
    }, BROADCAST_TRAILING_MS);

    if (state.maxWaitTimer === null) {
      state.maxWaitTimer = setTimeout(() => {
        const cur = coalesceByUser.get(userId);
        if (!cur) {
          return;
        }
        if (cur.trailingTimer !== null) {
          clearTimeout(cur.trailingTimer);
        }
        coalesceByUser.delete(userId);
        fanoutNow(userId);
      }, BROADCAST_MAX_WAIT_MS);
    }
  }

  wss.on("connection", (ws: AuthedSocket) => {
    let authedUserId: string | null = null;
    const authTimer = setTimeout(() => {
      if (!authedUserId) {
        ws.close(4401, "auth timeout");
      }
    }, 10_000);

    ws.on("message", (buf) => {
      if (authedUserId) {
        return;
      }
      let body: unknown;
      try {
        body = JSON.parse(String(buf));
      } catch {
        ws.close(4400, "invalid json");
        return;
      }
      if (!body || typeof body !== "object") {
        ws.close(4400, "invalid envelope");
        return;
      }
      const rec = body as Record<string, unknown>;
      if (rec["type"] !== "auth" || typeof rec["token"] !== "string") {
        ws.close(4400, "expected {type:\"auth\",token:\"...\"}");
        return;
      }
      const verified = verifyListenRealtimeToken(secret, rec["token"]);
      if (!verified) {
        ws.close(4403, "invalid token");
        return;
      }
      authedUserId = verified.userId;
      ws.userId = verified.userId;
      clearTimeout(authTimer);
      addToRoom(verified.userId, ws);
      ws.send(buildReadyFrame());
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      if (authedUserId) {
        removeFromRoom(authedUserId, ws);
      }
    });
  });

  let pg: Client | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let shuttingDown = false;

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function schedulePgReconnect(): void {
    if (shuttingDown) {
      return;
    }
    clearReconnectTimer();
    const delay = Math.min(
      PG_RECONNECT_MAX_MS,
      PG_RECONNECT_BASE_MS * 2 ** Math.min(reconnectAttempt, 6),
    );
    reconnectAttempt += 1;
    console.error(`[realtime] Postgres LISTEN reconnect in ${delay}ms`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectPgListen();
    }, delay);
  }

  async function connectPgListen(): Promise<void> {
    if (shuttingDown) {
      return;
    }
    if (pg) {
      try {
        pg.removeAllListeners();
        await pg.end();
      } catch {
        // ignore teardown errors
      }
      pg = null;
    }

    const client = new Client({ connectionString: env.DATABASE_URL });
    pg = client;

    client.on("notification", (msg) => {
      if (msg.channel !== NOTIFY_CHANNEL || !msg.payload) {
        return;
      }
      const parsed = parseNotifyPayload(msg.payload);
      if (!parsed) {
        return;
      }
      scheduleBroadcast(parsed.userId);
    });

    client.on("error", (err) => {
      console.error(
        "[realtime] Postgres client error:",
        summarizeThrowableForLog(err),
      );
      schedulePgReconnect();
    });

    client.on("end", () => {
      if (!shuttingDown) {
        console.error("[realtime] Postgres client ended; scheduling reconnect");
        schedulePgReconnect();
      }
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
      reconnectAttempt = 0;
      console.log(`[realtime] WebSocket listening on ws://0.0.0.0:${port}`);
      console.log(`[realtime] Subscribed to NOTIFY ${NOTIFY_CHANNEL}`);
    } catch (err) {
      console.error(
        "[realtime] Postgres connect failed:",
        summarizeThrowableForLog(err),
      );
      schedulePgReconnect();
    }
  }

  void connectPgListen();

  process.on("SIGTERM", () => {
    shuttingDown = true;
    clearReconnectTimer();
    void pg?.end();
    wss.close();
  });
}

main();
