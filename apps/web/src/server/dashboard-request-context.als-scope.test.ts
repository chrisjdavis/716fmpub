import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { readFreshDashboardAnalyticsBundleForRequest } from "./dashboard-analytics-bundle-request-cache";
import { withDashboardRequestContext } from "./dashboard-request-context";

const tryReadFresh = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    tryReadFreshDashboardAnalyticsBundle: tryReadFresh,
  };
});

describe("withDashboardRequestContext + bundle read", () => {
  it("dedupes sequential reads after a microtask hop", async () => {
    tryReadFresh.mockClear();
    const pool = {} as Pool;
    await withDashboardRequestContext(async () => {
      await readFreshDashboardAnalyticsBundleForRequest(pool, "u1");
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      await readFreshDashboardAnalyticsBundleForRequest(pool, "u1");
    });
    expect(tryReadFresh).toHaveBeenCalledTimes(1);
  });
});
