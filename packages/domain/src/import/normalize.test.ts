import { describe, expect, it } from "vitest";

import { normalizeImportString } from "./normalize.js";

describe("normalizeImportString", () => {
  it("treats nullish as empty", () => {
    expect(normalizeImportString(undefined)).toBe("");
    expect(normalizeImportString(null)).toBe("");
  });

  it("trims, lowercases, and collapses whitespace", () => {
    expect(normalizeImportString("  The   Beatles  ")).toBe("the beatles");
    expect(normalizeImportString("Foo\n\tBar")).toBe("foo bar");
  });

  it("applies NFC normalization", () => {
    const decomposed = "caf\u0065\u0301";
    expect(normalizeImportString(decomposed)).toBe("café");
  });
});
