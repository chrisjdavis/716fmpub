import { describe, expect, it } from "vitest";
import { dashboardRangeOverviewKicker } from "./dashboard-range-hero-labels";

describe("dashboardRangeOverviewKicker", () => {
  it("describes the selected window without internal messaging", () => {
    expect(dashboardRangeOverviewKicker("7d")).toContain("7 days");
    expect(dashboardRangeOverviewKicker("30d")).toContain("30 days");
    expect(dashboardRangeOverviewKicker("90d")).toContain("90 days");
    expect(dashboardRangeOverviewKicker("all")).toContain("all time");
    expect(dashboardRangeOverviewKicker("7d")).toContain("Window");
    expect(dashboardRangeOverviewKicker("7d")).not.toContain("server");
  });
});
