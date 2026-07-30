import { describe, expect, it } from "vitest";
import { displayLabel } from "./dashboard-display-label";

describe("displayLabel", () => {
  it("returns trimmed text when non-empty", () => {
    expect(displayLabel("  Bowie  ", "[X]")).toBe("Bowie");
  });

  it("returns sentinel for null, undefined, whitespace, or empty", () => {
    expect(displayLabel(null, "[X]")).toBe("[X]");
    expect(displayLabel(undefined, "[X]")).toBe("[X]");
    expect(displayLabel("", "[X]")).toBe("[X]");
    expect(displayLabel("   \t", "[X]")).toBe("[X]");
  });
});
