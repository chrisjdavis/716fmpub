import type { DashboardRecentListen } from "@vs/db";
import { DashboardCoverThumb } from "./dashboard-cover-thumb";
import { displayLabel } from "./dashboard-display-label";
import { DashboardInstantTimestamp } from "./dashboard-instant-timestamp";

const dashboardPairedColumnListClass =
  "flex min-h-0 flex-1 flex-col rounded-md border border-hairline";

const dashboardRecentTrackRowClass =
  "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-stretch gap-3 px-4 py-2.5 sm:gap-4 sm:px-5 sm:py-3";

const listLabelClass =
  "mb-4 font-mono text-label font-normal uppercase tracking-[0.1em] text-overline";

export function DashboardRecentTracksListBody({
  recentListens,
}: Readonly<{ recentListens: DashboardRecentListen[] }>) {
  return (
    <>
      <h3 className={listLabelClass}>Recent tracks</h3>
      {recentListens.length === 0 ? (
        <p className="font-mono text-caption uppercase tracking-[0.06em] text-warning">
          [NO RECENT TRACKS IN THIS WINDOW]
        </p>
      ) : (
        <ul className={dashboardPairedColumnListClass}>
          {recentListens.map((row, index) => (
            <li
              key={row.listen_id}
              className={index === recentListens.length - 1 ? "" : "border-b border-hairline"}
            >
              <div className={dashboardRecentTrackRowClass}>
                <DashboardCoverThumb
                  tallRow
                  musicbrainzReleaseMbid={row.musicbrainz_release_mbid}
                  lastfmCoverImageUrl={row.lastfm_cover_image_url}
                  alt={`${displayLabel(row.track_title, "Track")} · ${displayLabel(row.artist_name, "Artist")}`}
                />
                <div className="min-w-0 flex flex-col gap-0.5">
                  <p className="font-sans text-body text-foreground">
                    {displayLabel(row.track_title, "[UNKNOWN TRACK]")}
                  </p>
                  <p className="font-mono text-caption uppercase tracking-[0.04em] text-muted">
                    {displayLabel(row.artist_name, "[UNKNOWN ARTIST]")}
                    {row.album_title?.trim()
                      ? ` · ${displayLabel(row.album_title, "[UNKNOWN ALBUM]")}`
                      : ""}
                  </p>
                  <time
                    className="mt-1 font-mono text-caption uppercase tracking-[0.04em] text-muted normal-case"
                    dateTime={row.played_at}
                  >
                    <DashboardInstantTimestamp iso={row.played_at} variant="human" />
                  </time>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
