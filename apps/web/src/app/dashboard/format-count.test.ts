import { describe, expect, it } from "vitest";
import { formatCount } from "./format-count";

describe("formatCount", () => {
  it("groups thousands with commas (en-US)", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe("1,000");
    expect(formatCount(171_169)).toBe("171,169");
  });

  it("truncates toward zero", () => {
    expect(formatCount(12.9)).toBe("12");
    expect(formatCount(-3.7)).toBe("-3");
  });

  it("stringifies non-finite numbers", () => {
    expect(formatCount(Number.NaN)).toBe("NaN");
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});
