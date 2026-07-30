import { describe, expect, it } from "vitest";
import type { ImportJobRecord } from "@vs/db";
import { importJobApiRowFromDb, importJobApiRowFromRecord } from "./import-job-row";

const base = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  label: "x",
  lastfm_username: "lastfm_x",
  source: "user",
  error_message: null as string | null,
  items_total: null as number | null,
  items_processed: 0,
  checkpoint_pages_completed: 0,
  checkpoint_oldest_uts: null as string | null,
  created_at: "2020-01-01T00:00:00.000Z",
  updated_at: "2020-01-01T00:00:00.000Z",
};

describe("importJobApiRowFromDb", () => {
  it("parses a valid stage", () => {
    const row = importJobApiRowFromDb({ ...base, stage: "queued" });
    expect(row?.stage).toBe("queued");
  });

  it("defaults missing checkpoint columns to zero / null", () => {
    const { checkpoint_pages_completed: _c, checkpoint_oldest_uts: _o, ...rest } = base;
    const row = importJobApiRowFromDb({ ...rest, stage: "running" });
    expect(row).toMatchObject({
      checkpoint_pages_completed: 0,
      checkpoint_oldest_uts: null,
    });
  });

  it("returns null for an unknown stage string", () => {
    expect(importJobApiRowFromDb({ ...base, stage: "succeeded" })).toBeNull();
  });
});

const sampleRecord: ImportJobRecord = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  user_id: "user",
  label: "L",
  lastfm_username: "lf",
  source: "user",
  stage: "running",
  error_message: null,
  items_total: null,
  items_processed: 3,
  checkpoint_pages_completed: 1,
  checkpoint_oldest_uts: BigInt(99),
  created_at: "2020-01-01T00:00:00.000Z",
  updated_at: "2020-01-01T00:01:00.000Z",
};

describe("importJobApiRowFromRecord", () => {
  it("VS-42: omits durable user identifiers and credential-shaped keys from the public import job row", () => {
    const row = importJobApiRowFromRecord(sampleRecord);
    const keys = Object.keys(row);
    expect(keys).not.toContain("user_id");
    for (const banned of [
      "password",
      "token",
      "secret",
      "session",
      "hash",
      "authorization",
    ]) {
      expect(keys.some((k) => k.toLowerCase().includes(banned))).toBe(false);
    }
  });

  it("VS-51: sanitizes label, username, and error_message for public JSON", () => {
    const row = importJobApiRowFromRecord({
      ...sampleRecord,
      label: "a\u0000z",
      lastfm_username: "u\u202Ev",
      error_message: "e\u0001f",
    });
    expect(row.label).toBe("az");
    expect(row.lastfm_username).toBe("uv");
    expect(row.error_message).toBe("e f");
  });

  it("projects the public API fields from a repository record", () => {
    expect(importJobApiRowFromRecord(sampleRecord)).toEqual({
      id: sampleRecord.id,
      label: sampleRecord.label,
      lastfm_username: sampleRecord.lastfm_username,
      source: "user",
      stage: "running",
      error_message: null,
      items_total: null,
      items_processed: 3,
      checkpoint_pages_completed: 1,
      checkpoint_oldest_uts: "99",
      created_at: sampleRecord.created_at,
      updated_at: sampleRecord.updated_at,
    });
  });
});
