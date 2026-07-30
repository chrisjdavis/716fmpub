import type { RawImportListenRow } from "../rawScrobbles.js";

/** Fixed clock for range assertions (UTC). */
export const ANALYTICS_FIXTURE_NOW_MS = Date.UTC(2026, 3, 14, 12, 0, 0);

/** Inside default 30d / 7d windows when `nowMs` is {@link ANALYTICS_FIXTURE_NOW_MS}. */
export const PLAYED_AT_RECENT_A = "2026-04-10T18:30:00.000Z";
export const PLAYED_AT_RECENT_B = "2026-04-11T09:15:00.000Z";
export const PLAYED_AT_RECENT_C = "2026-04-12T22:00:00.000Z";

/** Older than 7d but within 30d / 90d for `ANALYTICS_FIXTURE_NOW_MS`. */
export const PLAYED_AT_OUTSIDE_7D = "2026-04-01T08:00:00.000Z";

/**
 * Real-shaped Last.fm import rows (field names match `RawImportListenRow` / worker mapping).
 * Includes MBIDs, punctuation in names, and JSON `raw_payload` similar to API pages.
 */
export function realisticLastfmImportRows(): RawImportListenRow[] {
  const mbidArtistNational = "6de884b6-2a32-4d25-8d2b-24081c513191";
  const mbidAlbumNational = "fake0000-0000-4000-8000-0000000000a1";
  const mbidTrackDemons = "fake0000-0000-4000-8000-0000000000t1";
  const mbidArtistRadio = "a74b1b7f-71a5-4011-9441-d0d30824601a";
  const mbidAlbumOk = "fake0000-0000-4000-8000-0000000000a2";
  const mbidTrackParanoid = "fake0000-0000-4000-8000-0000000000t2";

  return [
    {
      uts: 1_713_830_400n,
      playedAt: PLAYED_AT_OUTSIDE_7D,
      artistName: "The National",
      albumName: "Trouble Will Find Me",
      trackName: "Demons",
      artistMbid: mbidArtistNational,
      albumMbid: mbidAlbumNational,
      trackMbid: mbidTrackDemons,
      loved: false,
      rawPayload: {
        name: "Demons",
        artist: { mbid: mbidArtistNational, "#text": "The National" },
        album: { mbid: mbidAlbumNational, "#text": "Trouble Will Find Me" },
      },
    },
    {
      uts: 1_713_916_800n,
      playedAt: PLAYED_AT_RECENT_A,
      artistName: "The National",
      albumName: "Trouble Will Find Me",
      trackName: "Demons",
      artistMbid: mbidArtistNational,
      albumMbid: mbidAlbumNational,
      trackMbid: mbidTrackDemons,
      loved: false,
      rawPayload: { name: "Demons" },
    },
    {
      uts: 1_713_917_000n,
      playedAt: PLAYED_AT_RECENT_B,
      artistName: "The National",
      albumName: "Trouble Will Find Me",
      trackName: "Sea of Love",
      artistMbid: mbidArtistNational,
      albumMbid: mbidAlbumNational,
      trackMbid: "fake0000-0000-4000-8000-0000000000t3",
      loved: true,
      rawPayload: { name: "Sea of Love", loved: "1" },
    },
    {
      uts: 1_713_918_000n,
      playedAt: PLAYED_AT_RECENT_C,
      artistName: "Radiohead",
      albumName: "OK Computer",
      trackName: "Paranoid Android",
      artistMbid: mbidArtistRadio,
      albumMbid: mbidAlbumOk,
      trackMbid: mbidTrackParanoid,
      loved: false,
      rawPayload: {
        name: "Paranoid Android",
        mbid: mbidTrackParanoid,
      },
    },
  ];
}

/** Identical logical events (same hash): duplicate page fetch / overlap. */
export function duplicateHashRows(): [RawImportListenRow, RawImportListenRow] {
  const row: RawImportListenRow = {
    uts: 1_714_000_000n,
    playedAt: "2026-04-13T10:00:00.000Z",
    artistName: "The National",
    albumName: "Trouble Will Find Me",
    trackName: "Demons",
    artistMbid: "6de884b6-2a32-4d25-8d2b-24081c513191",
    albumMbid: "fake0000-0000-4000-8000-0000000000a1",
    trackMbid: "fake0000-0000-4000-8000-0000000000t1",
    loved: false,
    rawPayload: { name: "Demons" },
  };
  return [row, { ...row, rawPayload: { ...row.rawPayload, dup: true } }];
}
