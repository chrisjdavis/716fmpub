import { describe, expect, it } from "vitest";

import { computeSourceEventHash } from "./sourceEventHash.js";

describe("computeSourceEventHash", () => {
  it("matches for duplicate logical events after normalization", () => {
    const a = computeSourceEventHash({
      uts: 1_704_000_000,
      artistName: "  The   Cure  ",
      trackName: "Just Like Heaven",
      albumName: "Kiss Me, Kiss Me, Kiss Me",
      loved: false,
    });
    const b = computeSourceEventHash({
      uts: "1704000000",
      artistName: "the cure",
      trackName: "just like heaven",
      albumName: "kiss me, kiss me, kiss me",
      loved: false,
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs for non-duplicate events", () => {
    const base = {
      uts: 1_704_000_001,
      artistName: "Radiohead",
      trackName: "Weird Fishes",
      albumName: "In Rainbows",
    } as const;
    const h1 = computeSourceEventHash(base);
    const h2 = computeSourceEventHash({ ...base, uts: 1_704_000_002 });
    const h3 = computeSourceEventHash({ ...base, trackName: "Weird Fishes / Arpeggi" });
    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it("includes optional mbid and loved in the fingerprint", () => {
    const without = computeSourceEventHash({
      uts: 100,
      artistName: "A",
      trackName: "B",
    });
    const withMbid = computeSourceEventHash({
      uts: 100,
      artistName: "A",
      trackName: "B",
      trackMbid: "550E8400-E29B-41D4-A716-446655440000",
    });
    const loved = computeSourceEventHash({
      uts: 100,
      artistName: "A",
      trackName: "B",
      loved: true,
    });
    expect(without).not.toBe(withMbid);
    expect(without).not.toBe(loved);
  });
});
