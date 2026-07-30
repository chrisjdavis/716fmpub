import { computeSourceEventHash } from "@vs/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  batchInsertRawScrobbles,
  type RawImportListenRow,
  type RawScrobbleDbExecutor,
} from "./rawScrobbles.js";

function sampleRow(overrides: Partial<RawImportListenRow> = {}): RawImportListenRow {
  return {
    uts: 1_700_000_000n,
    playedAt: "2023-11-14T22:13:20.000Z",
    artistName: "Artist",
    albumName: "Album",
    trackName: "Track",
    artistMbid: null,
    albumMbid: null,
    trackMbid: null,
    loved: false,
    rawPayload: { name: "Track", mbid: "" },
    ...overrides,
  };
}

describe("batchInsertRawScrobbles", () => {
  const query = vi.fn();
  const db = { query } as RawScrobbleDbExecutor;

  beforeEach(() => {
    query.mockReset();
  });

  it("returns zeros for an empty batch", async () => {
    const out = await batchInsertRawScrobbles(db, {
      importJobId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      rows: [],
    });
    expect(out).toEqual({ inserted: 0, skippedDuplicates: 0 });
    expect(query).not.toHaveBeenCalled();
  });

  it("runs unnest insert with conflict target and returns inserted count", async () => {
    query.mockResolvedValueOnce({ rows: [{ row_count: "2" }] });
    const rows = [sampleRow(), sampleRow({ uts: 1_700_000_001n, playedAt: "2023-11-14T22:13:21.000Z" })];
    const out = await batchInsertRawScrobbles(db, {
      importJobId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      rows,
    });
    expect(out).toEqual({ inserted: 2, skippedDuplicates: 0 });
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("unnest(");
    expect(sql).toContain("on conflict (user_id, source_event_hash) do nothing");
    expect(sql).toContain("raw_payload_json::jsonb");
    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(Array.isArray(params?.[0])).toBe(true);
    expect((params?.[0] as string[]).every((v) => v === "11111111-1111-4111-8111-111111111111")).toBe(
      true,
    );
    const hashes = params?.[11] as string[];
    expect(hashes?.[0]).toBe(
      computeSourceEventHash({
        uts: rows[0]!.uts,
        artistName: rows[0]!.artistName,
        trackName: rows[0]!.trackName,
        albumName: rows[0]!.albumName,
        artistMbid: rows[0]!.artistMbid,
        albumMbid: rows[0]!.albumMbid,
        trackMbid: rows[0]!.trackMbid,
        loved: rows[0]!.loved,
      }),
    );
    const payloadCol = params?.[12] as string[];
    expect(payloadCol?.[0]).toContain('"name":"Track"');
  });

  it("counts skipped rows when the database reports fewer inserts than inputs", async () => {
    query.mockResolvedValueOnce({ rows: [{ row_count: 1 }] });
    const out = await batchInsertRawScrobbles(db, {
      importJobId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      rows: [sampleRow(), sampleRow()],
    });
    expect(out.inserted).toBe(1);
    expect(out.skippedDuplicates).toBe(1);
  });

  it("chunks large batches into multiple statements", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ row_count: "500" }] })
      .mockResolvedValueOnce({ rows: [{ row_count: "1" }] });
    const rows = Array.from({ length: 501 }, (_, i) =>
      sampleRow({
        uts: BigInt(1_700_000_000 + i),
        playedAt: new Date((1_700_000_000 + i) * 1000).toISOString(),
        trackName: `T${i}`,
      }),
    );
    const out = await batchInsertRawScrobbles(db, {
      importJobId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      rows,
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(out.inserted).toBe(501);
    expect(out.skippedDuplicates).toBe(0);
  });
});
