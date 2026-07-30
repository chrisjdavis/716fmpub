import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");

type BudgetFile = {
  firstLoadJsKb: {
    maxSharedFirstLoadJsKb: number;
    maxMiddlewareKb: number;
    enforcedRoutesMaxFirstLoadJsKb: Record<string, number>;
  };
  httpMsMax: Record<string, number>;
  dbLoaderMsMax: Record<string, number>;
};

type BuildVerify = {
  firstLoadJsKb: {
    shared: number;
    middlewareKb: number;
    routes: Record<string, number>;
  };
};

type RecordedBaseline = {
  httpMs: Record<string, unknown>;
  dbLoaderMs: Record<string, unknown>;
};

function readJson<T>(relFromRepo: string): T {
  const p = join(repoRoot, relFromRepo);
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

describe("VS-84 static performance budgets vs committed baselines", () => {
  it("keeps the VS-75 build verify First Load JS snapshot inside envelope ceilings", () => {
    const budgets = readJson<BudgetFile>("docs/performance-budgets/vs-84-budgets.json");
    const verify = readJson<BuildVerify>("docs/performance-baseline/vs-75-build-first-load-verify.json");
    expect(verify.firstLoadJsKb.shared).toBeLessThanOrEqual(budgets.firstLoadJsKb.maxSharedFirstLoadJsKb);
    expect(verify.firstLoadJsKb.middlewareKb).toBeLessThanOrEqual(
      budgets.firstLoadJsKb.maxMiddlewareKb,
    );
    for (const [route, maxKb] of Object.entries(budgets.firstLoadJsKb.enforcedRoutesMaxFirstLoadJsKb)) {
      const got = verify.firstLoadJsKb.routes[route];
      expect(got, `missing route ${route} in vs-75 verify`).toBeDefined();
      expect(got!).toBeLessThanOrEqual(maxKb);
    }
  });

  it("keeps recorded next_dev warm http timings inside declared envelopes", () => {
    const budgets = readJson<BudgetFile>("docs/performance-budgets/vs-84-budgets.json");
    const rec = readJson<RecordedBaseline>("docs/performance-baseline/recorded-2026-04-16-local.json");
    for (const [key, maxMs] of Object.entries(budgets.httpMsMax)) {
      const raw = rec.httpMs[key];
      expect(typeof raw, `httpMs.${key} missing from baseline snapshot`).toBe("number");
      expect(raw as number).toBeLessThanOrEqual(maxMs);
    }
  });

  it("keeps recorded DB loader snapshot fields inside declared envelopes", () => {
    const budgets = readJson<BudgetFile>("docs/performance-budgets/vs-84-budgets.json");
    const rec = readJson<RecordedBaseline>("docs/performance-baseline/recorded-2026-04-16-local.json");
    for (const [key, maxMs] of Object.entries(budgets.dbLoaderMsMax)) {
      const raw = rec.dbLoaderMs[key];
      expect(typeof raw, `dbLoaderMs.${key} missing from baseline snapshot`).toBe("number");
      expect(raw as number).toBeLessThanOrEqual(maxMs);
    }
  });
});
