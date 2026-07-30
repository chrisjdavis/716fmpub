import type { Pool, PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithDbPerfContext } from "./db-perf-context.js";
import { ensurePoolQueryInstrumentation } from "./instrument-pool-query.js";

function stubPool(): Pool {
  const client: PoolClient = {
    query: vi
      .fn()
      .mockResolvedValue({ rowCount: 1, command: "SELECT" }) as PoolClient["query"],
    release: vi.fn(),
  } as unknown as PoolClient;
  const pool = {
    query: vi
      .fn()
      .mockResolvedValue({ rowCount: 0, command: "SELECT" }) as Pool["query"],
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
  return pool;
}

describe("instrument-pool-query", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.VS_PERF_DB_QUERIES = "all";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.VS_PERF_DB_QUERIES;
  });

  it("emits structured timing for pool.query without SQL text", async () => {
    const pool = stubPool();
    ensurePoolQueryInstrumentation(pool);
    await runWithDbPerfContext(
      { source: "GET /api/unit", sourceKind: "api", traceId: "trace-unit-1" },
      async () => {
        await pool.query("select * from users where email = $1", ["x"]);
      },
    );
    expect(console.log).toHaveBeenCalled();
    const raw = vi.mocked(console.log).mock.calls[0][0] as string;
    const line = JSON.parse(raw) as Record<string, unknown>;
    expect(line.vs_perf).toBe(true);
    expect(line.category).toBe("db_query");
    expect(line.dbSource).toBe("GET /api/unit");
    expect(line.traceId).toBe("trace-unit-1");
    expect(line.textLen).toBeGreaterThan(0);
    expect(raw).not.toContain("users");
  });

});
