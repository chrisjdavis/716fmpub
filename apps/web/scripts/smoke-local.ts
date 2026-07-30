import { AUTH_SESSION_COOKIE_NAME, ADVANCED_ENTITLEMENT_REQUIRED_CODE } from "@vs/domain";
import { loadServerEnv } from "@vs/env";
import { summarizeThrowableForLog } from "@vs/sensitive";
import {
  LOCAL_TEST_ACCOUNT_EMAIL,
  localTestAccountPassword,
} from "../src/dev/local-test-account";
import { parseVsSessionCookie } from "../src/dev/parse-vs-session-cookie";

function readBaseUrl(): string {
  const raw = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3456";
  return raw.replace(/\/$/, "");
}

function fail(message: string): never {
  console.error(`smoke-local: ${message}`);
  process.exit(1);
}

async function fetchText(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    fail(
      `request to ${url} failed (${detail}). Is the web server running (npm run dev)?`,
    );
  }
}

async function main(): Promise<void> {
  const base = readBaseUrl();
  const env = loadServerEnv();
  const email = LOCAL_TEST_ACCOUNT_EMAIL;
  const password = localTestAccountPassword(env);

  const homeRes = await fetchText(`${base}/`);
  if (!homeRes.ok) {
    fail(`GET / expected 2xx, got ${homeRes.status}`);
  }

  const loginRes = await fetchText(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    const body = await loginRes.text();
    fail(
      `POST /api/auth/login expected 2xx, got ${loginRes.status} body=${body.slice(0, 500)}`,
    );
  }

  const setCookies =
    typeof loginRes.headers.getSetCookie === "function"
      ? loginRes.headers.getSetCookie()
      : loginRes.headers.get("set-cookie")
        ? [loginRes.headers.get("set-cookie") as string]
        : [];
  const sessionToken = parseVsSessionCookie(setCookies);
  if (!sessionToken) {
    fail(
      `login response missing ${AUTH_SESSION_COOKIE_NAME} cookie (Set-Cookie: ${JSON.stringify(setCookies)})`,
    );
  }

  const cookieHeader = `${AUTH_SESSION_COOKIE_NAME}=${sessionToken}`;

  const meRes = await fetchText(`${base}/api/me`, {
    headers: { cookie: cookieHeader },
  });
  if (!meRes.ok) {
    const body = await meRes.text();
    fail(
      `GET /api/me expected 2xx, got ${meRes.status} body=${body.slice(0, 500)}`,
    );
  }
  const meJson: unknown = await meRes.json();
  if (
    typeof meJson !== "object" ||
    meJson === null ||
    !("user" in meJson) ||
    typeof (meJson as { user?: unknown }).user !== "object" ||
    (meJson as { user: { email?: unknown } }).user.email !== email
  ) {
    fail(`GET /api/me returned unexpected JSON: ${JSON.stringify(meJson)}`);
  }

  const windowTotalRes = await fetchText(
    `${base}/api/analytics/window-total?range=30d`,
    { headers: { cookie: cookieHeader } },
  );
  if (!windowTotalRes.ok) {
    const body = await windowTotalRes.text();
    fail(
      `GET /api/analytics/window-total expected 2xx, got ${windowTotalRes.status} body=${body.slice(0, 500)}`,
    );
  }
  const windowTotalJson: unknown = await windowTotalRes.json();
  if (
    typeof windowTotalJson !== "object" ||
    windowTotalJson === null ||
    typeof (windowTotalJson as { total_scrobbles?: unknown }).total_scrobbles !== "number"
  ) {
    fail(
      `GET /api/analytics/window-total returned unexpected JSON: ${JSON.stringify(windowTotalJson)}`,
    );
  }

  const summaryRes = await fetchText(
    `${base}/api/analytics/summary?range=30d`,
    { headers: { cookie: cookieHeader } },
  );
  if (summaryRes.status === 403) {
    const summaryJson: unknown = await summaryRes.json().catch(() => null);
    if (
      typeof summaryJson !== "object" ||
      summaryJson === null ||
      (summaryJson as { code?: unknown }).code !== ADVANCED_ENTITLEMENT_REQUIRED_CODE
    ) {
      fail(
        `GET /api/analytics/summary Core gate: expected 403 + code ${ADVANCED_ENTITLEMENT_REQUIRED_CODE}, body=${JSON.stringify(summaryJson)}`,
      );
    }
  } else if (!summaryRes.ok) {
    const body = await summaryRes.text();
    fail(
      `GET /api/analytics/summary expected 2xx or 403 (Core), got ${summaryRes.status} body=${body.slice(0, 500)}`,
    );
  } else {
    const summaryJson: unknown = await summaryRes.json();
    if (
      typeof summaryJson !== "object" ||
      summaryJson === null ||
      !("summary" in summaryJson)
    ) {
      fail(
        `GET /api/analytics/summary returned unexpected JSON: ${JSON.stringify(summaryJson)}`,
      );
    }
  }

  console.log(
    "smoke-local: OK (home, login, /api/me, /api/analytics/window-total, /api/analytics/summary)",
  );
}

main().catch((err: unknown) => {
  console.error("smoke-local: fatal", summarizeThrowableForLog(err));
  process.exit(1);
});
