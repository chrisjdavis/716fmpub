import { describe, expect, it } from "vitest";
import type { DashboardArchiveListen } from "@vs/db";
import { buildArchiveVirtualRows, estimateArchiveVirtualRowHeight } from "./archive-flat-rows";

function fakeListen(played_at: string, listen_id: string): DashboardArchiveListen {
  return {
    listen_id,
    played_at,
    track_id: "t",
    track_title: "Track",
    artist_name: "Artist",
    album_id: null,
    album_title: null,
    listen_source: "lastfm",
    musicbrainz_release_mbid: null,
    lastfm_cover_image_url: null,
  };
}

describe("buildArchiveVirtualRows", () => {
  it("orders months newest-first and nests listens under month headers", () => {
    const listens = [
      fakeListen("2024-01-15T12:00:00.000Z", "a"),
      fakeListen("2024-03-01T12:00:00.000Z", "b"),
      fakeListen("2024-01-20T12:00:00.000Z", "c"),
    ];
    const rows = buildArchiveVirtualRows(listens, false);
    expect(rows.map((r) => r.type)).toEqual([
      "month",
      "listen",
      "month",
      "listen",
      "listen",
    ]);
    expect(rows[0]).toMatchObject({ type: "month", monthKey: "2024-03" });
    expect(rows[1]).toMatchObject({ type: "listen", listen: listens[1] });
    const jan = rows.filter((r) => r.type === "month" && r.monthKey === "2024-01");
    expect(jan).toHaveLength(1);
    const janListens = rows.filter((r) => r.type === "listen" && r.listen.played_at.startsWith("2024-01"));
    expect(janListens).toHaveLength(2);
  });

  it("appends load sentinel when requested", () => {
    const rows = buildArchiveVirtualRows([fakeListen("2024-05-01T00:00:00.000Z", "x")], true);
    expect(rows[rows.length - 1]).toEqual({ type: "load-sentinel", rowKey: "s:more" });
  });

  it("builds large lists quickly (flat-row prep for virtualization)", () => {
    const listens: DashboardArchiveListen[] = [];
    for (let i = 0; i < 20_000; i++) {
      listens.push(fakeListen("2024-06-15T12:00:00.000Z", `id-${i}`));
    }
    const t0 = performance.now();
    const rows = buildArchiveVirtualRows(listens, true);
    const ms = performance.now() - t0;
    expect(rows.length).toBe(20_002);
    expect(ms).toBeLessThan(500);
  });
});

describe("estimateArchiveVirtualRowHeight", () => {
  it("returns sensible defaults per row kind", () => {
    expect(estimateArchiveVirtualRowHeight({ type: "month", monthKey: "2024-01", rowKey: "m" })).toBe(52);
    expect(
      estimateArchiveVirtualRowHeight({
        type: "listen",
        rowKey: "l",
        listen: fakeListen("2024-01-01T00:00:00.000Z", "z"),
      }),
    ).toBe(80);
    expect(estimateArchiveVirtualRowHeight({ type: "load-sentinel", rowKey: "s" })).toBe(4);
  });
});
