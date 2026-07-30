import { describe, expect, it } from "vitest";
import { pgTimestamptzToIsoOrNull, pgTimestamptzToIsoString } from "./pgTimestamptz.js";

describe("pgTimestamptzToIsoString", () => {
  it("formats Date as ISO", () => {
    const d = new Date("2026-04-01T12:00:00.000Z");
    expect(pgTimestamptzToIsoString(d)).toBe("2026-04-01T12:00:00.000Z");
  });

  it("passes through non-empty strings", () => {
    expect(pgTimestamptzToIsoString("2026-04-01T12:00:00.000Z")).toBe("2026-04-01T12:00:00.000Z");
  });

  it("stringifies unexpected types like historical row mappers", () => {
    expect(pgTimestamptzToIsoString(null)).toBe("null");
    expect(pgTimestamptzToIsoString(undefined)).toBe("undefined");
  });
});

describe("pgTimestamptzToIsoOrNull", () => {
  it("returns null for null and undefined", () => {
    expect(pgTimestamptzToIsoOrNull(null)).toBeNull();
    expect(pgTimestamptzToIsoOrNull(undefined)).toBeNull();
  });

  it("delegates non-null values to string form", () => {
    const d = new Date("2026-04-01T12:00:00.000Z");
    expect(pgTimestamptzToIsoOrNull(d)).toBe("2026-04-01T12:00:00.000Z");
    expect(pgTimestamptzToIsoOrNull("2026-04-01T12:00:00.000Z")).toBe("2026-04-01T12:00:00.000Z");
  });
});
