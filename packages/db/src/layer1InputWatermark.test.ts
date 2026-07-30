import { describe, expect, it } from "vitest";
import {
  layer1InputWatermarksEqual,
  mergeLayer1InputWatermarkParts,
} from "./layer1InputWatermark.js";

describe("mergeLayer1InputWatermarkParts", () => {
  it("returns null when all parts are null", () => {
    expect(
      mergeLayer1InputWatermarkParts({
        maxPlayedAt: null,
        maxListenCreatedAt: null,
        maxImportCompletedAt: null,
      }),
    ).toBeNull();
  });

  it("returns the latest timestamp across parts", () => {
    const played = new Date("2026-01-01T00:00:00.000Z");
    const created = new Date("2026-01-05T00:00:00.000Z");
    const imp = new Date("2026-01-03T00:00:00.000Z");
    expect(
      mergeLayer1InputWatermarkParts({
        maxPlayedAt: played,
        maxListenCreatedAt: created,
        maxImportCompletedAt: imp,
      })?.getTime(),
    ).toBe(created.getTime());
  });

  it("uses import completion when listens are absent", () => {
    const imp = new Date("2026-02-10T12:00:00.000Z");
    expect(
      mergeLayer1InputWatermarkParts({
        maxPlayedAt: null,
        maxListenCreatedAt: null,
        maxImportCompletedAt: imp,
      }),
    ).toEqual(imp);
  });
});

describe("layer1InputWatermarksEqual", () => {
  it("treats two nulls as equal", () => {
    expect(layer1InputWatermarksEqual(null, null)).toBe(true);
  });

  it("treats null vs date as unequal", () => {
    expect(layer1InputWatermarksEqual(null, new Date())).toBe(false);
    expect(layer1InputWatermarksEqual(new Date(), null)).toBe(false);
  });

  it("compares by epoch ms", () => {
    const a = new Date("2026-03-01T00:00:00.000Z");
    const b = new Date(a.getTime());
    expect(layer1InputWatermarksEqual(a, b)).toBe(true);
  });
});
