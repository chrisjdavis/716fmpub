import { describe, expect, it } from "vitest";
import { mapImportListenEventToRawRow } from "./mapImportListenEventToRawRow.js";

describe("mapImportListenEventToRawRow", () => {
  it("maps Last.fm fields and drops trackUrl", () => {
    const out = mapImportListenEventToRawRow({
      uts: 12n,
      playedAt: "1970-01-01T00:00:12.000Z",
      artistName: "A",
      albumName: null,
      trackName: "T",
      artistMbid: null,
      albumMbid: null,
      trackMbid: null,
      loved: true,
      trackUrl: "https://example.com",
      rawPayload: { name: "T" },
    });
    expect(out).toEqual({
      uts: 12n,
      playedAt: "1970-01-01T00:00:12.000Z",
      artistName: "A",
      albumName: null,
      trackName: "T",
      artistMbid: null,
      albumMbid: null,
      trackMbid: null,
      loved: true,
      rawPayload: { name: "T" },
    });
  });
});
