import { describe, expect, it } from "vitest";

import { normalizeImportMbid } from "./mbid.js";
import { computeSourceEventHash } from "./sourceEventHash.js";

describe("normalizeImportMbid", () => {
  it("returns null for null, undefined, empty, and whitespace-only", () => {
    expect(normalizeImportMbid(null)).toBeNull();
    expect(normalizeImportMbid(undefined)).toBeNull();
    expect(normalizeImportMbid("")).toBeNull();
    expect(normalizeImportMbid("  \t  ")).toBeNull();
  });

  it("trims and lowercases non-empty values", () => {
    expect(normalizeImportMbid("  550E8400-E29B-41D4-A716-446655440000  ")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("stays aligned with computeSourceEventHash MBID folding", () => {
    const a = computeSourceEventHash({
      uts: 1,
      artistName: "x",
      trackName: "y",
      trackMbid: "  AA-BB  ",
    });
    const b = computeSourceEventHash({
      uts: 1,
      artistName: "x",
      trackName: "y",
      trackMbid: "aa-bb",
    });
    expect(a).toBe(b);
  });
});
