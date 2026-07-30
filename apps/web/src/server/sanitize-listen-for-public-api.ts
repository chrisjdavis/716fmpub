import type { DashboardArchiveListen, DashboardRecentListen } from "@vs/db";
import { sanitizeUserFacingPlainText } from "@vs/domain";

/**
 * Canonical listen fields returned to browsers (archive + recent lists).
 * Strips control and bidi-spoof characters; HTML angle brackets are left intact — callers must
 * render as plain text (React text nodes or equivalent), never as HTML.
 */
export function sanitizeDashboardRecentListenForPublicApi(
  row: DashboardRecentListen,
): DashboardRecentListen {
  return {
    ...row,
    track_title: sanitizeUserFacingPlainText(row.track_title),
    artist_name: sanitizeUserFacingPlainText(row.artist_name),
    album_title: row.album_title === null ? null : sanitizeUserFacingPlainText(row.album_title),
  };
}

export function sanitizeDashboardArchiveListenForPublicApi(
  row: DashboardArchiveListen,
): DashboardArchiveListen {
  return {
    ...sanitizeDashboardRecentListenForPublicApi(row),
    listen_source: row.listen_source,
  };
}
