import { describe, expect, it } from "vitest";

import { mapLastfmRecentTrackWire } from "./mapLastfmTrack.js";

describe("mapLastfmRecentTrackWire", () => {
  it("maps extended Last.fm track fields into the internal import shape", () => {
    const event = mapLastfmRecentTrackWire({
      name: "Track One",
      url: "https://www.last.fm/music/_/Track+One",
      mbid: "track-mbid",
      artist: { "#text": "Artist A", mbid: "artist-mbid" },
      album: { "#text": "Album B", mbid: "album-mbid" },
      date: { uts: "1700000000" },
      loved: "1",
    });

    expect(event.uts).toBe(1700000000n);
    expect(event.playedAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(event.artistName).toBe("Artist A");
    expect(event.albumName).toBe("Album B");
    expect(event.trackName).toBe("Track One");
    expect(event.artistMbid).toBe("artist-mbid");
    expect(event.albumMbid).toBe("album-mbid");
    expect(event.trackMbid).toBe("track-mbid");
    expect(event.loved).toBe(true);
    expect(event.trackUrl).toBe("https://www.last.fm/music/_/Track+One");
    expect(event.rawPayload.name).toBe("Track One");
  });

  it("uses null album when album title is empty", () => {
    const event = mapLastfmRecentTrackWire({
      name: "T",
      artist: { "#text": "A", mbid: "" },
      album: { "#text": "", mbid: "" },
      date: { uts: "1" },
    });
    expect(event.albumName).toBeNull();
    expect(event.artistMbid).toBeNull();
  });

  it("reads artist from `name` when extended=1 omits `#text` (Last.fm wire)", () => {
    const event = mapLastfmRecentTrackWire({
      name: "Apocalypse Dreams",
      artist: {
        url: "https://www.last.fm/music/Tame+Impala",
        mbid: "63aa26c3-d59b-4da4-84ac-716b54f1ef4d",
        name: "Tame Impala",
      },
      album: { mbid: "0d2cb66c-3a32-4f81-b977-9231c461c34a", "#text": "Lonerism" },
      date: { uts: "1603188238" },
    });
    expect(event.artistName).toBe("Tame Impala");
    expect(event.artistMbid).toBe("63aa26c3-d59b-4da4-84ac-716b54f1ef4d");
    expect(event.albumName).toBe("Lonerism");
  });

  it("uses first non-empty artist when Last.fm returns an array", () => {
    const event = mapLastfmRecentTrackWire({
      name: "X",
      artist: [{ "#text": "", mbid: "" }, { name: "Second", mbid: "" }],
      date: { uts: "2" },
    });
    expect(event.artistName).toBe("Second");
  });
});
