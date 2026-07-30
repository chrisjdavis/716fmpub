import { describe, expect, it } from "vitest";
import { parseImportLatestGetJson } from "./import-latest-response";

describe("parseImportLatestGetJson", () => {
  it("accepts latest null", () => {
    expect(parseImportLatestGetJson({ latest: null })).toEqual({
      ok: true,
      latest: null,
    });
  });

  it("accepts a valid latest row", () => {
    const row = {
      id: "00000000-0000-4000-8000-000000000001",
      label: "t",
      lastfm_username: "u",
      source: "user",
      stage: "running",
      error_message: null,
      items_total: 10,
      items_processed: 3,
      checkpoint_pages_completed: 2,
      checkpoint_oldest_uts: "1714099500",
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
    };
    const out = parseImportLatestGetJson({ latest: row });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.latest).toEqual({ ...row, stage: "running" });
    }
  });

  it("rejects invalid stage", () => {
    const out = parseImportLatestGetJson({
      latest: {
        id: "1",
        label: "t",
        lastfm_username: "u",
        stage: "not-a-stage",
        error_message: null,
        items_total: null,
        items_processed: 0,
        checkpoint_pages_completed: 0,
        checkpoint_oldest_uts: null,
        created_at: "a",
        updated_at: "b",
      },
    });
    expect(out).toEqual({ ok: false, error: "[ERROR: INVALID IMPORT JOB ROW]" });
  });

  it("rejects wrong envelope", () => {
    expect(parseImportLatestGetJson({ foo: 1 }).ok).toBe(false);
  });
});
