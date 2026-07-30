/**
 * Normalized listen event for downstream import (raw_scrobbles / dedupe hashing).
 * Field names align with `SourceEventHashInput` in `@vs/domain` (uts, artistName,
 * trackName, albumName, MBIDs, loved) plus timestamps and provenance.
 */
export type LastfmImportListenEvent = Readonly<{
  uts: bigint;
  /** ISO 8601 instant derived from `uts` (UTC). */
  playedAt: string;
  artistName: string;
  albumName: string | null;
  trackName: string;
  artistMbid: string | null;
  albumMbid: string | null;
  trackMbid: string | null;
  loved: boolean;
  trackUrl: string | null;
  /** Verbatim Last.fm track object (JSON-serializable) for audit / replay. */
  rawPayload: Readonly<Record<string, unknown>>;
}>;

export type LastfmProviderFetchConfig = Readonly<{
  apiKey: string;
  /** Last.fm username (not email). */
  username: string;
  /** Tracks per request; Last.fm allows 1–200. */
  limitPerPage?: number;
  /** Only scrobbles after this UNIX time (inclusive), if set. */
  fromUnix?: number;
  /** Only scrobbles before this UNIX time (inclusive), if set. */
  toUnix?: number;
  /** Passed through to `scrobbles` (default 5). */
  maxRetries?: number;
}>;
