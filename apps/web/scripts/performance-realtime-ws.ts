/**
 * WebSocket control-plane timing: HTTP handshake → WS auth → first `ready` frame.
 * NOTIFY → `listens_updated` is a separate contract; see JSON `notifyToListensUpdated` in baseline.
 *
 *   SMOKE_BASE_URL=http://127.0.0.1:3456 npx dotenv -e .env -- npx tsx scripts/performance-realtime-ws.ts
 */
import { AUTH_CSRF_COOKIE_NAME } from "@vs/domain/auth-csrf-cookie";
import { AUTH_SESSION_COOKIE_NAME } from "@vs/domain/auth-session-cookie";
import { loadServerEnv } from "@vs/env";
import { summarizeThrowableForLog } from "@vs/sensitive";
import {
  LOCAL_TEST_ACCOUNT_EMAIL,
  localTestAccountPassword,
} from "../src/dev/local-test-account";
import { parseVsSessionCookie } from "../src/dev/parse-vs-session-cookie";
import { parseVsCsrfCookie } from "../src/dev/parse-vs-csrf-cookie";

function readBaseUrl(): string {
  const raw =
    process.env.PERF_BASELINE_BASE_URL ??
    process.env.SMOKE_BASE_URL ??
    "http://127.0.0.1:3456";
  return raw.replace(/\/$/, "");
}

function getSetCookieLines(res: Response): string[] {
  const h = res.headers;
  if (typeof h.getSetCookie === "function") {
    return h.getSetCookie();
  }
  const single = h.get("set-cookie");
  return single ? [single] : [];
}

type RealtimeJson =
  | { enabled: false }
  | { enabled: true; wsUrl: string; token: string };

function isRealtimeHandshake(json: unknown): json is RealtimeJson {
  if (!json || typeof json !== "object") {
    return false;
  }
  const o = json as Record<string, unknown>;
  if (o.enabled === false) {
    return true;
  }
  return (
    o.enabled === true &&
    typeof o.wsUrl === "string" &&
    o.wsUrl.length > 0 &&
    typeof o.token === "string" &&
    o.token.length > 0
  );
}

function wsAuthToReadyMs(wsUrl: string, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("WebSocket ready timeout (8s)"));
      }
    }, 8000);
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "auth", token }));
    });
    ws.addEventListener("message", (ev) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") {
        return;
      }
      if ((msg as Record<string, unknown>).type === "ready" && !settled) {
        settled = true;
        clearTimeout(timer);
        const ms = performance.now() - t0;
        ws.close();
        resolve(ms);
      }
    });
    ws.addEventListener("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error("WebSocket error event"));
      }
    });
  });
}

async function main(): Promise<void> {
  const base = readBaseUrl();
  const env = loadServerEnv();
  const email = LOCAL_TEST_ACCOUNT_EMAIL;
  const password = localTestAccountPassword(env);

  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    console.log(
      JSON.stringify(
        {
          error: "login_failed",
          status: loginRes.status,
          hint: "Use NODE_ENV=development for http:// localhost cookies (same as smoke:local).",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  const setCookies = getSetCookieLines(loginRes);
  const sessionToken = parseVsSessionCookie(setCookies);
  const csrf = parseVsCsrfCookie(setCookies);
  if (!sessionToken || !csrf) {
    console.log(JSON.stringify({ error: "missing_session_or_csrf", setCookies }, null, 2));
    process.exit(1);
  }

  const cookieHeader = [
    `${AUTH_SESSION_COOKIE_NAME}=${sessionToken}`,
    `${AUTH_CSRF_COOKIE_NAME}=${encodeURIComponent(csrf)}`,
  ].join("; ");

  const tHttp0 = performance.now();
  const rtRes = await fetch(`${base}/api/me/listen-realtime`, {
    headers: { cookie: cookieHeader },
  });
  const tHttp1 = performance.now();
  const rtJson: unknown = await rtRes.json().catch(() => null);
  const httpHandshakeMs = tHttp1 - tHttp0;

  const out: Record<string, unknown> = {
    recordedAt: new Date().toISOString(),
    baseUrl: base,
    httpListenRealtimeApiMs: httpHandshakeMs,
    listenRealtimeJson: rtJson,
  };

  if (!rtRes.ok) {
    out.wsAuthToReadyMs = null;
    out.wsAuthToReadyReason = `GET /api/me/listen-realtime failed with HTTP ${rtRes.status}`;
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (!isRealtimeHandshake(rtJson)) {
    out.wsAuthToReadyMs = null;
    out.wsAuthToReadyReason = "Unexpected listen-realtime JSON shape.";
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (rtJson.enabled === false) {
    out.wsAuthToReadyMs = null;
    out.wsAuthToReadyReason =
      "Realtime disabled in server env (LISTEN_REALTIME_ENABLED / token signing material).";
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  try {
    const ms = await wsAuthToReadyMs(rtJson.wsUrl, rtJson.token);
    out.wsAuthToReadyMs = ms;
    out.wsAuthToReadyReason = null;
  } catch (err) {
    out.wsAuthToReadyMs = null;
    out.wsAuthToReadyReason = err instanceof Error ? err.message : String(err);
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err: unknown) => {
  console.error("performance-realtime-ws:", summarizeThrowableForLog(err));
  process.exit(1);
});
