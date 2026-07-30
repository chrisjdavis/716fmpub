/**
 * CI gate: production `next build`, parse First Load JS table, compare to
 * `docs/performance-budgets/vs-84-budgets.json`.
 *
 *   npm run perf:check:budgets -w web
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNextBuildRouteMetrics } from "../src/performance-budgets/parse-next-build-route-metrics";

const __dirname = dirname(fileURLToPath(import.meta.url));

type BudgetFile = {
  firstLoadJsKb: {
    maxSharedFirstLoadJsKb: number;
    maxMiddlewareKb: number;
    enforcedRoutesMaxFirstLoadJsKb: Record<string, number>;
  };
};

function readBudgets(): BudgetFile {
  const repoRoot = join(__dirname, "..", "..", "..");
  const rawPath =
    process.env.VS84_PERF_BUDGETS_JSON ??
    join(repoRoot, "docs", "performance-budgets", "vs-84-budgets.json");
  return JSON.parse(readFileSync(rawPath, "utf-8")) as BudgetFile;
}

function main(): void {
  const webRoot = join(__dirname, "..");
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(npmCmd, ["run", "build"], {
    cwd: webRoot,
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env },
  });
  const log = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  if (r.status !== 0) {
    console.error("perf:check:budgets: next build failed\n", log.slice(-12_000));
    process.exit(r.status ?? 1);
  }

  const parsed = parseNextBuildRouteMetrics(log);
  const budgets = readBudgets();
  const { enforcedRoutesMaxFirstLoadJsKb, maxSharedFirstLoadJsKb, maxMiddlewareKb } =
    budgets.firstLoadJsKb;

  const violations: string[] = [];

  if (parsed.sharedFirstLoadKb == null) {
    violations.push("parse: missing shared First Load JS line in build output");
  } else if (parsed.sharedFirstLoadKb > maxSharedFirstLoadJsKb) {
    violations.push(
      `shared First Load JS ${parsed.sharedFirstLoadKb} kB > budget ${maxSharedFirstLoadJsKb} kB`,
    );
  }

  if (parsed.middlewareKb == null) {
    violations.push("parse: missing middleware kB line in build output");
  } else if (parsed.middlewareKb > maxMiddlewareKb) {
    violations.push(
      `middleware ${parsed.middlewareKb} kB > budget ${maxMiddlewareKb} kB`,
    );
  }

  for (const [route, maxKb] of Object.entries(enforcedRoutesMaxFirstLoadJsKb)) {
    const got = parsed.routes[route];
    if (got == null) {
      violations.push(`parse: route ${route} missing from build table`);
    } else if (got > maxKb) {
      violations.push(`route ${route}: ${got} kB > budget ${maxKb} kB`);
    }
  }

  if (violations.length > 0) {
    console.error("VS-84 performance budget violations:\n- " + violations.join("\n- "));
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        checkedRoutes: Object.keys(enforcedRoutesMaxFirstLoadJsKb),
        sharedFirstLoadKb: parsed.sharedFirstLoadKb,
        middlewareKb: parsed.middlewareKb,
      },
      null,
      2,
    ),
  );
}

main();
