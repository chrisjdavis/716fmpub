import type { LastfmImportListenEvent } from "./types.js";

type LastfmNamedEntity = Readonly<{
  "#text"?: string;
  /** Present on `extended=1` artist objects instead of `#text`. */
  name?: string;
  mbid?: string;
  /** Last.fm includes extra keys (e.g. `url`, `image`) we ignore for mapping. */
  url?: string;
}>;

/** Shape returned by Last.fm `user.getrecenttracks` (JSON) for a dated scrobble. */
export type LastfmRecentTrackWire = Readonly<{
  name?: string;
  url?: string;
  mbid?: string;
  artist?: LastfmNamedEntity | string | readonly unknown[];
  album?: LastfmNamedEntity | string | readonly unknown[];
  date?: Readonly<{ uts?: string }>;
  loved?: string | number;
}>;

/**
 * Last.fm JSON varies by `extended`:
 * - without extended: `{ "#text": "Artist", "mbid": "..." }`
 * - with extended=1: `{ "name": "Artist", "url": "...", "mbid": "", ... }` (often no `#text`)
 * Repeated XML nodes can also surface as an array of those objects.
 */
function textFromNamed(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const el of value) {
      const t = textFromNamed(el);
      if (t.trim() !== "") {
        return t;
      }
    }
    return "";
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const hashText = o["#text"];
    if (typeof hashText === "string" && hashText.trim() !== "") {
      return hashText;
    }
    const n = o.name;
    if (typeof n === "string" && n.trim() !== "") {
      return n;
    }
  }
  return "";
}

function mbidFromNamed(value: unknown): string | null {
  if (value === undefined || value === null || typeof value === "string") {
    return null;
  }
  if (Array.isArray(value)) {
    for (const el of value) {
      const m = mbidFromNamed(el);
      if (m) {
        return m;
      }
    }
    return null;
  }
  if (typeof value === "object") {
    const m = (value as Record<string, unknown>).mbid;
    if (typeof m === "string" && m.trim() !== "") {
      return m.trim();
    }
  }
  return null;
}

function trackMbid(track: LastfmRecentTrackWire): string | null {
  const m = track.mbid;
  if (typeof m !== "string" || m.trim() === "") {
    return null;
  }
  return m.trim();
}

function parseLoved(loved: string | number | undefined): boolean {
  if (loved === undefined) {
    return false;
  }
  if (typeof loved === "number") {
    return loved === 1;
  }
  return loved === "1" || loved.toLowerCase() === "true";
}

function asJsonRecord(track: LastfmRecentTrackWire): Readonly<Record<string, unknown>> {
  return track as unknown as Readonly<Record<string, unknown>>;
}

export function mapLastfmRecentTrackWire(
  track: LastfmRecentTrackWire,
): LastfmImportListenEvent {
  const utsRaw = track.date?.uts;
  if (typeof utsRaw !== "string" || !/^-?\d+$/.test(utsRaw)) {
    throw new TypeError("Last.fm track missing date.uts for a dated scrobble");
  }
  const uts = BigInt(utsRaw);
  const playedAt = new Date(Number(uts) * 1000).toISOString();

  const artistName = textFromNamed(track.artist);
  const albumNameRaw = textFromNamed(track.album);
  const trackName = typeof track.name === "string" ? track.name : "";

  return {
    uts,
    playedAt,
    artistName,
    albumName: albumNameRaw === "" ? null : albumNameRaw,
    trackName,
    artistMbid: mbidFromNamed(track.artist),
    albumMbid: mbidFromNamed(track.album),
    trackMbid: trackMbid(track),
    loved: parseLoved(track.loved),
    trackUrl: typeof track.url === "string" && track.url !== "" ? track.url : null,
    rawPayload: asJsonRecord(track),
  };
}
