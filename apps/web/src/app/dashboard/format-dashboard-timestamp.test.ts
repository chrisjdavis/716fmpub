import { describe, expect, it } from "vitest";
import {
  formatDashboardTimestamp,
  formatDashboardTimestampHuman,
} from "./format-dashboard-timestamp";

describe("formatDashboardTimestamp", () => {
  it("formats a Zulu ISO string to second-precision UTC copy", () => {
    expect(formatDashboardTimestamp("2024-06-01T12:34:56.789Z")).toBe(
      "2024-06-01 12:34:56 UTC",
    );
  });

  it("formats in a named IANA zone when provided", () => {
    expect(formatDashboardTimestamp("2024-06-01T12:34:56.789Z", "America/New_York")).toBe(
      "2024-06-01 08:34:56 EDT",
    );
  });

  it("returns a visible sentinel for empty input", () => {
    expect(formatDashboardTimestamp("")).toBe("[TIMESTAMP MISSING]");
    expect(formatDashboardTimestamp("   ")).toBe("[TIMESTAMP MISSING]");
  });

  it("returns a visible sentinel for non-parseable strings", () => {
    expect(formatDashboardTimestamp("not-a-date")).toBe(
      "[UNPARSEABLE TIMESTAMP: not-a-date]",
    );
  });
});

describe("formatDashboardTimestampHuman", () => {
  it("formats a Zulu instant as readable UTC (Intl)", () => {
    const s = formatDashboardTimestampHuman("2024-06-01T12:34:56.789Z");
    expect(s).toContain("2024");
    expect(s).toContain("Jun");
    expect(s).toMatch(/12:34/);
    expect(s).toMatch(/UTC|GMT/);
  });

  it("matches formatDashboardTimestamp edge cases", () => {
    expect(formatDashboardTimestampHuman("")).toBe("[TIMESTAMP MISSING]");
    expect(formatDashboardTimestampHuman("not-a-date")).toBe(
      "[UNPARSEABLE TIMESTAMP: not-a-date]",
    );
  });
});
