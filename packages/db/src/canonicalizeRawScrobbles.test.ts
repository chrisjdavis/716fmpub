import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalizePendingRawScrobblesBatch } from "./canonicalizeRawScrobbles.js";

describe("canonicalizePendingRawScrobblesBatch", () => {
  const release = vi.fn();
  const query = vi.fn();

  beforeEach(() => {
    query.mockReset();
    release.mockReset();
  });

  it("returns zeros and commits when no pending rows are returned", async () => {
    query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined);
    const client = { query, release };
    const db = {
      connect: vi.fn().mockResolvedValue(client),
    };
    const out = await canonicalizePendingRawScrobblesBatch(db, {
      importJobId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      limit: 100,
    });
    expect(out).toEqual({ examined: 0, succeeded: 0, failed: 0 });
    expect(query.mock.calls[0]?.[0]).toBe("begin");
    expect(String(query.mock.calls[1]?.[0])).toContain("from raw_scrobbles");
    expect(String(query.mock.calls[1]?.[0])).toContain("for update skip locked");
    expect(query.mock.calls[1]?.[1]).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      100,
    ]);
    expect(query.mock.calls[2]?.[0]).toBe("commit");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and rethrows when begin fails", async () => {
    query.mockRejectedValueOnce(new Error("boom"));
    const client = { query, release };
    const db = { connect: vi.fn().mockResolvedValue(client) };
    await expect(
      canonicalizePendingRawScrobblesBatch(db, {
        importJobId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
      }),
    ).rejects.toThrow("boom");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
