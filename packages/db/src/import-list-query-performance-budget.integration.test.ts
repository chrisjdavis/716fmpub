import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listImportJobsForUserWithTotalCount } from "./importJobs.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

type PgLiteBudgetFile = {
  importJobsListWithTotalCount: {
    fixtureRowCount: number;
    warmupIterations: number;
    timedIterations: number;
    maxMedianWallMsPgLite: number;
  };
};

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

describe.sequential("VS-84 import list query performance (PGlite)", () => {
  let pglite: PGlite;
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  beforeAll(async () => {
    const cfg = JSON.parse(
      readFileSync(join(repoRoot, "docs/performance-budgets/vs-84-pglite-query-budgets.json"), "utf-8"),
    ) as PgLiteBudgetFile;
    const n = cfg.importJobsListWithTotalCount.fixtureRowCount;

    pglite = new PGlite();
    await applyMigrationsToPglite(pglite);
    await pglite.query(
      `insert into users (id, email, password_hash)
       values ($1::uuid, 'perf-budget@example.test', 'x')`,
      [userId],
    );
    await pglite.exec(`
      insert into import_jobs (user_id, label, lastfm_username, stage, source, created_at, updated_at)
      select '${userId}'::uuid,
             'bulk-' || g::text,
             'lf',
             'completed',
             'user',
             now() - (g || ' minutes')::interval,
             now()
      from generate_series(1, ${n}) g
    `);
  });

  afterAll(async () => {
    await pglite.close();
  });

  it("listImportJobsForUserWithTotalCount stays within the PGlite wall-time budget", async () => {
    const cfg = JSON.parse(
      readFileSync(join(repoRoot, "docs/performance-budgets/vs-84-pglite-query-budgets.json"), "utf-8"),
    ) as PgLiteBudgetFile;
    const { warmupIterations, timedIterations, maxMedianWallMsPgLite } =
      cfg.importJobsListWithTotalCount;
    const pool = pgliteAsPool(pglite);

    for (let i = 0; i < warmupIterations; i++) {
      await listImportJobsForUserWithTotalCount(pool, { userId, limit: 50, offset: 0 });
    }
    const samples: number[] = [];
    for (let i = 0; i < timedIterations; i++) {
      const t0 = performance.now();
      const out = await listImportJobsForUserWithTotalCount(pool, {
        userId,
        limit: 50,
        offset: 0,
      });
      samples.push(performance.now() - t0);
      expect(out.records.length).toBeGreaterThan(0);
      expect(out.totalCount).toBe(cfg.importJobsListWithTotalCount.fixtureRowCount);
    }
    expect(median(samples)).toBeLessThanOrEqual(maxMedianWallMsPgLite);
  });
});
