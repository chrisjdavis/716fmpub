import { normalizeImportMbid } from "./mbid.js";

/** Cover Art Archive thumbnail widths (see MusicBrainz Cover Art Archive API). */
export type CoverArtThumbnailSize = 250 | 500 | 1200;

const MUSICBRAINZ_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * HTTPS URL for the "front" cover thumbnail on coverartarchive.org for a release MBID.
 * Returns null when the value is missing, whitespace-only, or not a UUID-shaped string
 * (aligned with {@link normalizeImportMbid} trimming/lowercasing).
 * Missing artwork still yields 404 after redirect; callers should handle image errors in UI.
 */
export function coverArtArchiveFrontThumbnailUrl(
  releaseMbid: string | null | undefined,
  size: CoverArtThumbnailSize = 250,
): string | null {
  const mbid = normalizeImportMbid(releaseMbid);
  if (!mbid || !MUSICBRAINZ_UUID.test(mbid)) {
    return null;
  }
  return `https://coverartarchive.org/release/${mbid}/front-${size}`;
}
