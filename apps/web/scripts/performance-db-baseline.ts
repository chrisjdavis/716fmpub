/**
 * Server-side DB timings for dashboard-shaped loaders (no HTTP stack).
 *
 *   npx dotenv -e /path/to/.env -- npx tsx scripts/performance-db-baseline.ts
 *
 * VS-83 optional prior comparison (same machine / comparable env):
 *   VS83_PERF_PRIOR_JSON=docs/performance-baseline/recorded-2026-04-16-local.json npx dotenv …
 * Expect `dbLoaderMs.loadImportsPageData_page1` in that JSON; emitted `vs83.priorComparison.deltaMs`
 * is `warmRepeatMs - priorMs` (negative ⇒ faster than the prior snapshot).
 */
import { readFileSync } from "node:fs";
import { getPool } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { summarizeThrowableForLog } from "@vs/sensitive";
import { LOCAL_TEST_ACCOUNT_EMAIL } from "../src/dev/local-test-account";
import { loadArchivePageData, loadArchivePageShell } from "../src/server/archive-page-data";
import { loadDashboardPageData } from "../src/server/dashboard-page-data";
import { loadImportsPageData } from "../src/server/imports-page-data";

async function resolveUserId(
  pool: ReturnType<typeof getPool>,
  email: string,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `select id::text as id from users where lower(email) = lower($1) limit 1`,
    [email],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(`No user for email ${email} (run npm run seed:local -w web).`);
  }
  return id;
}

async function timeBlock<T>(label: string, fn: () => Promise<T>): Promise<{ label: string; ms: number }> {
  const t0 = performance.now();
  await fn();
  return { label, ms: performance.now() - t0 };
}

type PriorPerfJson = {
  dbLoaderMs?: {
    recordedAt?: string;
    loadImportsPageData_page1?: number;
  };
};

function tryPriorImportsBaselineMs(): {
  priorPath: string;
  priorMs: number;
  priorRecordedAt: string | null;
} | null {
  const rawPath = process.env.VS83_PERF_PRIOR_JSON?.trim();
  if (!rawPath) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(rawPath, "utf8")) as PriorPerfJson;
    const priorMs = parsed.dbLoaderMs?.loadImportsPageData_page1;
    if (typeof priorMs !== "number" || !Number.isFinite(priorMs)) {
      return null;
    }
    const priorRecordedAt =
      typeof parsed.dbLoaderMs?.recordedAt === "string" ? parsed.dbLoaderMs.recordedAt : null;
    return { priorPath: rawPath, priorMs, priorRecordedAt };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const env = loadServerEnv();
  const pool = getPool(env);
  const userId = await resolveUserId(pool, LOCAL_TEST_ACCOUNT_EMAIL);

  const importsPageInput = {
    listenSyncMinIntervalSeconds: env.LISTEN_SYNC_USER_MIN_INTERVAL_SEC,
    importHistoryPage: 1 as const,
  };

  const importsWarmRepeat = await timeBlock("loadImportsPageData_page1_warm_repeat", () =>
    loadImportsPageData(pool, userId, importsPageInput),
  );

  const prior = tryPriorImportsBaselineMs();
  const priorComparison =
    prior === null
      ? null
      : {
          priorJsonPath: prior.priorPath,
          priorRecordedAt: prior.priorRecordedAt,
          priorImportsPage1Ms: prior.priorMs,
          warmRepeatMs: importsWarmRepeat.ms,
          deltaMs: importsWarmRepeat.ms - prior.priorMs,
        };

  const blocks = await Promise.all([
    timeBlock("loadDashboardPageData_30d", () =>
      loadDashboardPageData(pool, userId, "30d", { allowAiLayer1Reads: true }),
    ),
    timeBlock("loadDashboardPageData_all", () =>
      loadDashboardPageData(pool, userId, "all", { allowAiLayer1Reads: true }),
    ),
    timeBlock("loadArchivePageShell", () =>
      loadArchivePageShell(pool, userId, { allowAiLayer1Reads: true }),
    ),
    timeBlock("loadArchivePageData", () =>
      loadArchivePageData(pool, userId, { allowAiLayer1Reads: true }),
    ),
    timeBlock("loadImportsPageData_page1", () =>
      loadImportsPageData(pool, userId, importsPageInput),
    ),
    timeBlock("getUserProfileFields", async () => {
      const { getUserProfileFields } = await import("@vs/db");
      await getUserProfileFields(pool, userId);
    }),
  ]);

  const vs83 = {
    ticket: "VS-83",
    measurementProtocol: {
      parallelBatchBlockLabel: "loadImportsPageData_page1 inside Promise.all batch",
      warmRepeatLabel: importsWarmRepeat.label,
      priorComparisonEnv: "VS83_PERF_PRIOR_JSON",
      priorComparisonShape:
        "Prior file must be JSON with numeric `dbLoaderMs.loadImportsPageData_page1` (see docs/performance-baseline/*.json).",
    },
    criticalLoadersAudited: [
      {
        route: "/dashboard",
        module: "apps/web/src/server/dashboard-page-data.ts",
        outcome:
          "Bootstrap already uses Promise.all(profile, latest); completed stats path parallelizes heavy reads. No VS-83 code change.",
      },
      {
        route: "/dashboard/archive",
        module: "apps/web/src/server/archive-page-data.ts",
        outcome:
          "No-bundle path parallelizes shell header and first listens page; bundle path unchanged in this ticket. No VS-83 code change.",
      },
      {
        route: "/dashboard/imports",
        module: "apps/web/src/server/imports-page-data.ts",
        outcome:
          "Collapsed sequential count+list into list+total combined query in the first parallel batch; optional second list when paging clamps.",
      },
      {
        route: "/dashboard (client listen transport)",
        module: "apps/web/src/app/dashboard/dashboard-listen-fingerprint-poller.tsx",
        outcome:
          "Removed mount-time fingerprint HTTP that duplicated listen-realtime handshake; polling still starts on fallback paths.",
      },
    ],
    priorComparison,
    warmRepeatTiming: importsWarmRepeat,
  };

  console.log(
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        userEmail: LOCAL_TEST_ACCOUNT_EMAIL,
        vs83,
        blocks,
      },
      null,
      2,
    ),
  );
}

main().catch((err: unknown) => {
  console.error("performance-db-baseline:", summarizeThrowableForLog(err));
  process.exit(1);
});
