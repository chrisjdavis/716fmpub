import { describe, expect, it } from "vitest";
import { isPlausibleRollingSevenDayListenSummary } from "./briefingWindowValidation.js";

describe("isPlausibleRollingSevenDayListenSummary", () => {
  it("accepts a normal 7d summary", () => {
    expect(
      isPlausibleRollingSevenDayListenSummary({ range: "7d", total_scrobbles: 120 }),
    ).toBe(true);
  });

  it("rejects wrong range", () => {
    expect(
      isPlausibleRollingSevenDayListenSummary({ range: "30d", total_scrobbles: 10 }),
    ).toBe(false);
  });

  it("rejects totals that look cumulative or corrupt", () => {
    expect(
      isPlausibleRollingSevenDayListenSummary({ range: "7d", total_scrobbles: 50_000 }),
    ).toBe(false);
  });
});
