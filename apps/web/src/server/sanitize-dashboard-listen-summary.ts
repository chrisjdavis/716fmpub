import type { DashboardListenSummary } from "@vs/db";
import { sanitizeUserFacingPlainText } from "@vs/domain";

/**
 * Normalizes user- or import-sourced display strings in {@link DashboardListenSummary} for any
 * JSON or SSR consumer. Numeric fields and `range` are unchanged.
 *
 * **Plain text only:** safe for React text nodes; not an HTML sanitizer.
 *
 * **URLs:** `top_tracks` / `top_albums` may include `lastfm_cover_image_url` from imports; this
 * helper does not alter URLs. Callers that place those values in `<img src>` must restrict to
 * `http:` / `https:` (see `DashboardCoverThumb` in the web app).
 */
export function sanitizeDashboardListenSummaryForPublicApi(
  summary: DashboardListenSummary,
): DashboardListenSummary {
  return {
    ...summary,
    top_artists: summary.top_artists.map((a) => ({
      ...a,
      name: sanitizeUserFacingPlainText(a.name),
    })),
    top_tracks: summary.top_tracks.map((t) => ({
      ...t,
      title: sanitizeUserFacingPlainText(t.title),
      artist_name: sanitizeUserFacingPlainText(t.artist_name),
    })),
    top_albums: summary.top_albums.map((b) => ({
      ...b,
      title: sanitizeUserFacingPlainText(b.title),
      artist_name: sanitizeUserFacingPlainText(b.artist_name),
    })),
  };
}
