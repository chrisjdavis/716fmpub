import { describe, expect, it } from "vitest";
import {
  importJobItemsTotalKnown,
  importJobShowsSegmentedProgressBar,
} from "./import-job-progress-helpers";

describe("importJobItemsTotalKnown", () => {
  it("is true for zero", () => {
    expect(importJobItemsTotalKnown(0)).toBe(true);
  });

  it("is true for positive", () => {
    expect(importJobItemsTotalKnown(100)).toBe(true);
  });

  it("is false for null", () => {
    expect(importJobItemsTotalKnown(null)).toBe(false);
  });

  it("is false for undefined", () => {
    expect(importJobItemsTotalKnown(undefined)).toBe(false);
  });

  it("is false for NaN", () => {
    expect(importJobItemsTotalKnown(Number.NaN)).toBe(false);
  });

  it("is false for negative", () => {
    expect(importJobItemsTotalKnown(-1)).toBe(false);
  });
});

describe("importJobShowsSegmentedProgressBar", () => {
  it("is false when total is zero", () => {
    expect(importJobShowsSegmentedProgressBar(0)).toBe(false);
  });

  it("is true when total is positive", () => {
    expect(importJobShowsSegmentedProgressBar(5)).toBe(true);
  });
});
