import { describe, expect, it } from "vitest";
import { getDbPerfContext, runWithDbPerfContext } from "./db-perf-context.js";

describe("db-perf-context", () => {
  it("exposes context inside runWithDbPerfContext", async () => {
    await runWithDbPerfContext(
      { source: "unit:test", sourceKind: "api" },
      async () => {
        expect(getDbPerfContext()).toEqual({
          source: "unit:test",
          sourceKind: "api",
        });
      },
    );
  });

  it("clears context after the async scope completes", async () => {
    await runWithDbPerfContext(
      { source: "unit:test", sourceKind: "job" },
      async () => {
        expect(getDbPerfContext()?.source).toBe("unit:test");
      },
    );
    expect(getDbPerfContext()).toBeUndefined();
  });
});
