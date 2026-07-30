import { createHash } from "node:crypto";

import { normalizeImportMbid } from "./mbid.js";
import { normalizeImportString } from "./normalize.js";

/**
 * Raw import fields used to compute a stable dedupe fingerprint for a source listen.
 * Mirrors the logical identity of `raw_scrobbles` without DB-generated columns.
 */
export type SourceEventHashInput = Readonly<{
  uts: bigint | number | string;
  artistName: string;
  trackName: string;
  albumName?: string | null;
  artistMbid?: string | null;
  albumMbid?: string | null;
  trackMbid?: string | null;
  loved?: boolean;
}>;

const HASH_VERSION = 1 as const;

function canonicalUts(uts: bigint | number | string): string {
  if (typeof uts === "bigint") {
    return uts.toString();
  }
  if (typeof uts === "number") {
    if (!Number.isFinite(uts)) {
      throw new TypeError("uts must be a finite number");
    }
    return BigInt(Math.trunc(uts)).toString();
  }
  const s = uts.trim();
  if (!/^-?\d+$/.test(s)) {
    throw new TypeError("uts string must be an integer decimal representation");
  }
  return BigInt(s).toString();
}

/**
 * Deterministic SHA-256 hex digest over canonicalized raw import fields.
 * Same logical event (after normalization) yields the same hash; distinct events differ.
 */
export function computeSourceEventHash(input: SourceEventHashInput): string {
  const canonical = JSON.stringify({
    v: HASH_VERSION,
    uts: canonicalUts(input.uts),
    artist: normalizeImportString(input.artistName),
    track: normalizeImportString(input.trackName),
    album: normalizeImportString(input.albumName ?? ""),
    artistMbid: normalizeImportMbid(input.artistMbid) ?? "",
    albumMbid: normalizeImportMbid(input.albumMbid) ?? "",
    trackMbid: normalizeImportMbid(input.trackMbid) ?? "",
    loved: Boolean(input.loved),
  });

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
