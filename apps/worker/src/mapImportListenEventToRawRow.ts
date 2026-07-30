import type { RawImportListenRow } from "@vs/db";
import type { LastfmImportListenEvent } from "@vs/lastfm-provider";

/** Maps a Last.fm listen event into the row shape expected by `batchInsertRawScrobbles`. */
export function mapImportListenEventToRawRow(
  event: LastfmImportListenEvent,
): RawImportListenRow {
  return {
    uts: event.uts,
    playedAt: event.playedAt,
    artistName: event.artistName,
    albumName: event.albumName,
    trackName: event.trackName,
    artistMbid: event.artistMbid,
    albumMbid: event.albumMbid,
    trackMbid: event.trackMbid,
    loved: event.loved,
    rawPayload: event.rawPayload,
  };
}
