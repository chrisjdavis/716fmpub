/**
 * Measures authenticated HTML + JSON endpoints for the VS-64 performance baseline.
 *
 * Requires a running web server and migrated database (see README).
 *
 *   SMOKE_BASE_URL=http://127.0.0.1:3460 npx dotenv -e /path/to/.env -- npx tsx scripts/performance-baseline.ts
 */
import { AUTH_CSRF_COOKIE_NAME } from "@vs/domain/auth-csrf-cookie";
import { API_CSRF_HEADER_NAME } from "@vs/domain/auth-csrf-header";
import { AUTH_SESSION_COOKIE_NAME } from "@vs/domain/auth-session-cookie";
import { LISTEN_FINGERPRINT_POLL_MS } from "@vs/domain/listen-fingerprint-poll";
import { loadServerEnv } from "@vs/env";
import { summarizeThrowableForLog } from "@vs/sensitive";
import {
  LOCAL_TEST_ACCOUNT_EMAIL,
  localTestAccountPassword,
} from "../src/dev/local-test-account";
import { parseVsSessionCookie } from "../src/dev/parse-vs-session-cookie";
import { parseVsCsrfCookie } from "../src/dev/parse-vs-csrf-cookie";
import { archiveVirtualDomBudgetSnapshot } from "../src/app/dashboard/archive/archive-virtual-dom-budget";

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

async function timedFetch(
  label: string,
  url: string,
  init?: RequestInit,
): Promise<{
  label: string;
  url: string;
  status: number;
  ok: boolean;
  msHeaders: number;
  msTotal: number;
  bytes: number;
}> {
  const t0 = performance.now();
  const res = await fetch(url, init);
  const t1 = performance.now();
  const buf = await res.arrayBuffer();
  const t2 = performance.now();
  return {
    label,
    url,
    status: res.status,
    ok: res.ok,
    msHeaders: t1 - t0,
    msTotal: t2 - t0,
    bytes: buf.byteLength,
  };
}

async function main(): Promise<void> {
  const base = readBaseUrl();
  const env = loadServerEnv();
  const email = LOCAL_TEST_ACCOUNT_EMAIL;
  const password = localTestAccountPassword(env);

  const home = await timedFetch("home_landing_html", `${base}/`);

  const tLogin0 = performance.now();
  const loginRes2 = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const tLogin1 = performance.now();
  await loginRes2.arrayBuffer();
  const tLogin2 = performance.now();
  const loginTimed = {
    label: "auth_login_json",
    url: `${base}/api/auth/login`,
    status: loginRes2.status,
    ok: loginRes2.ok,
    msHeaders: tLogin1 - tLogin0,
    msTotal: tLogin2 - tLogin0,
    bytes: 0,
  };

  if (!loginRes2.ok) {
    console.log(
      JSON.stringify(
        {
          error: "login_failed",
          status: loginRes2.status,
          baseUrl: base,
          hint: "Ensure DB migrated, seed account exists, and cookie security matches http(s) (use NODE_ENV=development for http:// localhost).",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const setCookies = getSetCookieLines(loginRes2);
  const sessionToken = parseVsSessionCookie(setCookies);
  const csrf = parseVsCsrfCookie(setCookies);
  if (!sessionToken) {
    console.log(JSON.stringify({ error: "missing_session_cookie", setCookies }, null, 2));
    process.exit(1);
  }
  if (!csrf) {
    console.log(JSON.stringify({ error: "missing_csrf_cookie", setCookies }, null, 2));
    process.exit(1);
  }

  const cookieHeader = [
    `${AUTH_SESSION_COOKIE_NAME}=${sessionToken}`,
    `${AUTH_CSRF_COOKIE_NAME}=${encodeURIComponent(csrf)}`,
  ].join("; ");
  const authedInit = (extra?: RequestInit): RequestInit => ({
    ...extra,
    headers: {
      ...extra?.headers,
      cookie: cookieHeader,
    },
    redirect: "manual",
  });

  const stats = await timedFetch(
    "stats_dashboard_html",
    `${base}/dashboard/explore`,
    authedInit(),
  );
  const archive = await timedFetch(
    "archive_dashboard_html",
    `${base}/dashboard/archive`,
    authedInit(),
  );
  const exportsPage = await timedFetch(
    "export_dashboard_html",
    `${base}/dashboard/export`,
    authedInit(),
  );
  const importsPage = await timedFetch(
    "imports_dashboard_html",
    `${base}/dashboard/imports`,
    authedInit(),
  );
  const settings = await timedFetch(
    "settings_dashboard_html",
    `${base}/dashboard/settings`,
    authedInit(),
  );

  const me = await timedFetch("api_me_json", `${base}/api/me`, authedInit());
  const summary = await timedFetch(
    "api_analytics_summary_json",
    `${base}/api/analytics/summary?range=30d`,
    authedInit(),
  );
  const archiveListensFirstPage = await timedFetch(
    "api_analytics_archive_listens_first_page_json",
    `${base}/api/analytics/archive-listens?range=all&source=all&type=tracks&limit=40`,
    authedInit(),
  );
  const dashboardRecentListens = await timedFetch(
    "api_analytics_recent_listens_json",
    `${base}/api/analytics/recent-listens?range=30d&limit=12`,
    authedInit(),
  );
  const importLatest = await timedFetch(
    "api_imports_latest_json",
    `${base}/api/imports/latest`,
    authedInit(),
  );
  const listenFp = await timedFetch(
    "api_listen_fingerprint_json",
    `${base}/api/me/listen-fingerprint`,
    authedInit(),
  );
  const tRt0 = performance.now();
  const listenRtRes = await fetch(`${base}/api/me/listen-realtime`, authedInit());
  const tRt1 = performance.now();
  const listenRtText = await listenRtRes.text();
  const tRt2 = performance.now();
  let listenRealtimeJson: unknown;
  try {
    listenRealtimeJson = JSON.parse(listenRtText) as unknown;
  } catch {
    listenRealtimeJson = null;
  }
  const listenRt = {
    label: "api_listen_realtime_handshake_json",
    url: `${base}/api/me/listen-realtime`,
    status: listenRtRes.status,
    ok: listenRtRes.ok,
    msHeaders: tRt1 - tRt0,
    msTotal: tRt2 - tRt0,
    bytes: listenRtText.length,
  };

  const tEx0 = performance.now();
  const exportPost = await fetch(`${base}/api/export/listens`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader,
      [API_CSRF_HEADER_NAME]: csrf,
    },
    body: JSON.stringify({ format: "json" }),
  });
  const tEx1 = performance.now();
  const exBody = await exportPost.text();
  const tEx2 = performance.now();
  const exportInit = {
    label: "api_export_listens_post_json",
    url: `${base}/api/export/listens`,
    status: exportPost.status,
    ok: exportPost.ok,
    msHeaders: tEx1 - tEx0,
    msTotal: tEx2 - tEx0,
    bytes: exBody.length,
  };

  const listenRealtimeEnabled =
    listenRtRes.ok &&
    listenRealtimeJson &&
    typeof listenRealtimeJson === "object" &&
    "enabled" in listenRealtimeJson
      ? (listenRealtimeJson as { enabled: unknown }).enabled === true
      : null;

  const benchmarkContract = {
    schemaVersion: 2 as const,
    serverResponseTimes: {
      captureMode: "next_dev_warm" as const,
      note: "Timings include Next dev server overhead; not production SLOs.",
      flows: {
        homeLandingHtmlMsTotal: home.msTotal,
        statsDashboardHtmlMsTotal: stats.msTotal,
        archiveDashboardHtmlMsTotal: archive.msTotal,
        apiAnalyticsArchiveListensFirstPageMsTotal: archiveListensFirstPage.msTotal,
        apiAnalyticsRecentListensMsTotal: dashboardRecentListens.msTotal,
        exportDashboardHtmlMsTotal: exportsPage.msTotal,
        importsDashboardHtmlMsTotal: importsPage.msTotal,
        settingsDashboardHtmlMsTotal: settings.msTotal,
        apiImportsLatestMsTotal: importLatest.msTotal,
        apiExportListensPostMsTotal: exportInit.msTotal,
      },
      nextStartAuthenticated: {
        value: null as null,
        unit: "ms",
        captured: false,
        reason:
          "next start uses NODE_ENV=production; session cookies are Secure and Node fetch against http://127.0.0.1 will not persist them. Use HTTPS with a locally trusted cert, Playwright, or paste Lighthouse navigation timings into docs/performance-baseline/*.json.",
      },
    },
    database: {
      loaderRoundTripMs: {
        note: "Run `npm run perf:baseline:db -w web` for aggregate loader timings (not per-query Postgres).",
      },
      perQueryPostgresMs: {
        value: null as null,
        captured: false,
        reason:
          "Per-statement timings require pg_stat_statements or EXPLAIN (ANALYZE) on each hot query; out of scope for the fetch-only harness.",
      },
    },
    websocket: {
      httpHandshakeListenRealtimeApiMs: listenRt.msTotal,
      wsAuthToReadyMs: {
        value: null as null,
        captured: false,
        reason:
          listenRealtimeEnabled === true
            ? "Not measured in this script; run `npm run perf:baseline:ws -w web` with realtime listening."
            : listenRealtimeEnabled === false
              ? "Realtime disabled for this server env."
              : "Could not read listen-realtime JSON during contract assembly.",
      },
      notifyListenChangeToListensUpdatedMs: {
        value: null as null,
        captured: false,
        reason:
          "Requires apps/realtime running, Postgres NOTIFY on listen_change, and a controlled listens mutation for the same user — not executed in the default harness.",
      },
    },
    clientRendering: {
      lighthouseLcpMs: {
        value: null as null,
        captured: false,
        reason:
          "Run Lighthouse (performance) against next start + HTTPS and paste into the JSON snapshot, or attach a second artifact file.",
      },
      hydrationOrMainThreadMs: {
        value: null as null,
        captured: false,
        reason:
          "Hydration cost is a browser main-thread measurement; not derivable from server-side fetch timings.",
      },
      listenFingerprintPollIntervalMs: LISTEN_FINGERPRINT_POLL_MS,
      noteImportStatusContract:
        "This harness measures `GET /api/imports/latest` only. The dashboard may also refresh from `GET /api/me/listen-fingerprint` polling (interval above) or WebSocket `listens_updated` when enabled. VS-72: archive HTML omits the first keyset page (see `api_analytics_archive_listens_first_page_json`); stats HTML streams recent tracks via Suspense (see `api_analytics_recent_listens_json`).",
      vs76ArchiveVirtualDomBudget: {
        note:
          "Deterministic upper bound on mounted virtual row wrappers vs naive mounting of every flat row. Flat row count uses the first archive API page size (limit=40) plus one sentinel row as a conservative placeholder until a client-side row count is plumbed through this fetch-only harness.",
        ...archiveVirtualDomBudgetSnapshot(40 + 1, 900),
      },
    },
  };

  const out = {
    recordedAt: new Date().toISOString(),
    baseUrl: base,
    gitSha: process.env.GIT_SHA ?? null,
    homeLanding: home,
    login: loginTimed,
    authenticatedHtml: [stats, archive, exportsPage, importsPage, settings],
    authenticatedApi: [
      me,
      summary,
      archiveListensFirstPage,
      dashboardRecentListens,
      importLatest,
      listenFp,
      listenRt,
      exportInit,
    ],
    benchmarkContract,
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err: unknown) => {
  console.error("performance-baseline:", summarizeThrowableForLog(err));
  process.exit(1);
});
