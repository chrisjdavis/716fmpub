import { describe, expect, it } from "vitest";
import type { ImportJobRecord } from "@vs/db";
import {
  classifyDashboardImportBucket,
  parseDashboardRangeSearchParam,
} from "./dashboard-page-data";

function baseRecord(overrides: Partial<ImportJobRecord> = {}): ImportJobRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-000000000002",
    label: "Test import",
    lastfm_username: "example_user",
    source: "user",
    stage: "queued",
    error_message: null,
    items_total: null,
    items_processed: 0,
    checkpoint_pages_completed: 0,
    checkpoint_oldest_uts: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseDashboardRangeSearchParam", () => {
  it("defaults missing param to 30d", () => {
    expect(parseDashboardRangeSearchParam(undefined)).toBe("30d");
  });

  it("accepts each supported range string", () => {
    expect(parseDashboardRangeSearchParam("7d")).toBe("7d");
    expect(parseDashboardRangeSearchParam("30d")).toBe("30d");
    expect(parseDashboardRangeSearchParam("90d")).toBe("90d");
    expect(parseDashboardRangeSearchParam("all")).toBe("all");
  });

  it("uses first entry when param is an array", () => {
    expect(parseDashboardRangeSearchParam(["90d", "7d"])).toBe("90d");
  });

  it("returns null for unsupported tokens", () => {
    expect(parseDashboardRangeSearchParam("1y")).toBeNull();
    expect(parseDashboardRangeSearchParam(["bogus"])).toBeNull();
  });
});

describe("classifyDashboardImportBucket", () => {
  it("returns empty/no_jobs when there is no latest row", () => {
    expect(classifyDashboardImportBucket(null)).toEqual({
      kind: "empty",
      reason: "no_jobs",
    });
  });

  it("returns empty/idle for idle stage", () => {
    expect(classifyDashboardImportBucket(baseRecord({ stage: "idle" }))).toEqual({
      kind: "empty",
      reason: "idle",
    });
  });

  it("returns in_progress for queued", () => {
    const r = baseRecord({ stage: "queued" });
    expect(classifyDashboardImportBucket(r)).toEqual({
      kind: "in_progress",
      record: r,
    });
  });

  it("returns in_progress for running", () => {
    const r = baseRecord({ stage: "running", items_processed: 12, items_total: 400 });
    expect(classifyDashboardImportBucket(r)).toEqual({
      kind: "in_progress",
      record: r,
    });
  });

  it("returns failed for failed", () => {
    const r = baseRecord({
      stage: "failed",
      error_message: "upstream timeout",
    });
    expect(classifyDashboardImportBucket(r)).toEqual({
      kind: "failed",
      record: r,
    });
  });

  it("returns completed for completed", () => {
    const r = baseRecord({ stage: "completed" });
    expect(classifyDashboardImportBucket(r)).toEqual({
      kind: "completed",
      record: r,
    });
  });
});
