import type { ImportJobApiRow } from "@/server/api/import-job-row";
import { describe, expect, it, vi } from "vitest";
import { loadTimeMachineExploreModel } from "./load-time-machine-explore";

describe("loadTimeMachineExploreModel", () => {
  it("VS-62: returns null without touching the pool when AI Layer 1 reads are not entitled", async () => {
    const pool = { query: vi.fn() };
    const job: ImportJobApiRow = {
      id: "job",
      label: "t",
      lastfm_username: "x",
      source: "user",
      stage: "completed",
      error_message: null,
      items_total: null,
      items_processed: 0,
      checkpoint_pages_completed: 0,
      checkpoint_oldest_uts: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const out = await loadTimeMachineExploreModel(pool as never, {
      userId: "u1",
      monthParam: null,
      viewParam: null,
      job,
      allowAiLayer1Reads: false,
    });
    expect(out).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
