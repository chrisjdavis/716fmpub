import { describe, expect, it } from "vitest";
import { dashboardRangeFromSearchParam } from "./dashboard-range-from-url";

describe("dashboardRangeFromSearchParam", () => {
  it("defaults invalid or empty to 30d", () => {
    expect(dashboardRangeFromSearchParam(null)).toBe("30d");
    expect(dashboardRangeFromSearchParam("")).toBe("30d");
    expect(dashboardRangeFromSearchParam("bogus")).toBe("30d");
  });

  it("accepts supported tokens", () => {
    expect(dashboardRangeFromSearchParam("7d")).toBe("7d");
    expect(dashboardRangeFromSearchParam("30d")).toBe("30d");
    expect(dashboardRangeFromSearchParam("90d")).toBe("90d");
    expect(dashboardRangeFromSearchParam("all")).toBe("all");
  });
});
