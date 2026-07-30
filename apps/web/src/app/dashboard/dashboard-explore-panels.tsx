import type { ReactNode } from "react";
import type { DashboardPageBody } from "@/server/dashboard-page-data";
import { DashboardCoverThumb } from "./dashboard-cover-thumb";
import { DashboardHero } from "./dashboard-hero";
import { DashboardRangePendingCard } from "./dashboard-range-pending-card";
import { displayLabel } from "./dashboard-display-label";
import { PanelHeader } from "./dashboard-panel-header";
import { inWindowBehaviorInsight } from "./dashboard-window-behavior";
import { formatCount } from "./format-count";
import { DashboardStatsFoundationPendingBanner } from "./dashboard-stats-foundation-pending-banner";

const panelSectionTitleWarningClass =
  "mb-6 font-mono text-heading font-normal uppercase leading-tight tracking-[0.06em] text-error";

const listLabelClass =
  "mb-4 font-mono text-label font-normal uppercase tracking-[0.1em] text-overline";

const DASHBOARD_IN_WINDOW_TOP_ARTISTS = 14;
const DASHBOARD_IN_WINDOW_MOST_REPLAYED = 10;

const dashboardPairedGridClass = "grid items-stretch gap-10 lg:grid-cols-2 lg:gap-12";
const dashboardPairedColumnCardClass = "flex h-full min-h-0 flex-col";
const dashboardPairedColumnBodyClass = "flex min-h-0 flex-1 flex-col";
const dashboardPairedColumnListClass =
  "flex min-h-0 flex-1 flex-col rounded-md border border-hairline";

const dashboardPanelsIntersticeHeightClass = "h-[22.08rem] md:h-[27.6rem]";
const dashboardPanelsIntersticeLineInsetClass = "top-[12%] bottom-[12%]";
const dashboardPanelsIntersticeLineGradientClass =
  "bg-[linear-gradient(to_bottom,transparent_0%,var(--border-visible)_20%,var(--border-visible)_80%,transparent_100%)]";

function DashboardExplorePanelsInterstice() {
  return (
    <div aria-hidden className={`relative w-full shrink-0 ${dashboardPanelsIntersticeHeightClass}`}>
      <div
        className={`pointer-events-none absolute left-1/2 w-[2px] -translate-x-1/2 ${dashboardPanelsIntersticeLineInsetClass} ${dashboardPanelsIntersticeLineGradientClass}`}
      />
    </div>
  );
}

export function DashboardExplorePanels({
  body,
  recentTracksSlot,
  statsFoundationPending = false,
}: Readonly<{
  body: Extract<DashboardPageBody, { kind: "completed" }>;
  recentTracksSlot: ReactNode;
  statsFoundationPending?: boolean;
}>) {
  const { summary, heroWindow } = body;
  const topArtists = summary.top_artists.slice(0, DASHBOARD_IN_WINDOW_TOP_ARTISTS);
  const topAlbums = summary.top_albums.slice(0, 15);
  const mostReplayed = summary.top_tracks
    .filter((t) => t.plays >= 2)
    .slice(0, DASHBOARD_IN_WINDOW_MOST_REPLAYED);
  const windowBehaviorInsight = inWindowBehaviorInsight(summary);

  return (
    <div className="flex flex-col">
      {statsFoundationPending ? <DashboardStatsFoundationPendingBanner /> : null}

      <div className="flex flex-col">
        <DashboardExplorePanelsInterstice />
        <DashboardHero summary={summary} heroWindow={heroWindow} />

        {summary.total_scrobbles === 0 ? (
          <>
            <DashboardExplorePanelsInterstice />
            <DashboardRangePendingCard>
              <section>
                <p className={panelSectionTitleWarningClass}>[NO DATA IN THIS WINDOW]</p>
                <p className="font-sans text-body text-foreground">
                  There are no canonical listens for this account in the selected range. Choose a
                  different window above, or confirm your latest import finished and includes plays
                  in this period.
                </p>
              </section>
            </DashboardRangePendingCard>
            <DashboardExplorePanelsInterstice />
          </>
        ) : (
          <DashboardExplorePanelsInterstice />
        )}

        <section aria-labelledby="dash-in-window-title">
          <div className="space-y-12 md:space-y-14">
            <PanelHeader
              kicker="In this window"
              title="The patterns worth looking at first."
              titleId="dash-in-window-title"
            />
            <div className={dashboardPairedGridClass}>
              <DashboardRangePendingCard className={dashboardPairedColumnCardClass}>
                <div className={dashboardPairedColumnBodyClass}>
                  <h3 className={listLabelClass}>Top artists</h3>
                  {topArtists.length === 0 ? (
                    <p className="font-mono text-caption uppercase tracking-[0.06em] text-warning">
                      [NO PLAYS IN THIS WINDOW]
                    </p>
                  ) : (
                    <ul className={dashboardPairedColumnListClass}>
                      {topArtists.map((a, index) => (
                        <li
                          key={a.artist_id}
                          className={
                            index === topArtists.length - 1 ? "" : "border-b border-hairline"
                          }
                        >
                          <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:gap-4 sm:px-5 sm:py-3">
                            <span className="font-mono text-caption uppercase tabular-nums tracking-[0.06em] text-muted">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <span className="min-w-0 font-sans text-body text-foreground">
                              {displayLabel(a.name, "[UNKNOWN ARTIST]")}
                            </span>
                            <span className="shrink-0 font-mono text-body tabular-nums text-display">
                              {formatCount(a.plays)}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </DashboardRangePendingCard>

              <DashboardRangePendingCard className={dashboardPairedColumnCardClass}>
                <div className={dashboardPairedColumnBodyClass}>
                  <h3 className={listLabelClass}>Most replayed tracks</h3>
                  {mostReplayed.length === 0 ? (
                    <p className="font-mono text-caption uppercase tracking-[0.06em] text-muted">
                      No track with more than one play in this window.
                    </p>
                  ) : (
                    <ul className={dashboardPairedColumnListClass}>
                      {mostReplayed.map((t, index) => (
                        <li
                          key={t.track_id}
                          className={
                            index === mostReplayed.length - 1 ? "" : "border-b border-hairline"
                          }
                        >
                          <div className="flex items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-5 sm:py-3">
                            <DashboardCoverThumb
                              musicbrainzReleaseMbid={t.musicbrainz_release_mbid}
                              lastfmCoverImageUrl={t.lastfm_cover_image_url}
                              alt={`${displayLabel(t.title, "Track")} · ${displayLabel(t.artist_name, "Artist")}`}
                            />
                            <div className="min-w-0 flex flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0 flex-1">
                                <p className="font-sans text-body text-foreground">
                                  {displayLabel(t.title, "[UNKNOWN TRACK]")}
                                </p>
                                <p className="font-mono text-caption uppercase tracking-[0.04em] text-muted">
                                  {displayLabel(t.artist_name, "[UNKNOWN ARTIST]")}
                                </p>
                              </div>
                              <span className="shrink-0 font-mono text-body tabular-nums text-display sm:pl-2">
                                {formatCount(t.plays)}
                              </span>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </DashboardRangePendingCard>
            </div>

            {windowBehaviorInsight ? (
              <DashboardRangePendingCard>
                <p className="max-w-3xl font-sans text-body leading-relaxed text-muted">
                  {windowBehaviorInsight}
                </p>
              </DashboardRangePendingCard>
            ) : null}
          </div>
        </section>

        <DashboardExplorePanelsInterstice />

        <section aria-labelledby="dash-archive-view-title">
          <div className="space-y-12 md:space-y-14">
            <PanelHeader
              kicker="Full archive view"
              title="Then go deeper."
              titleId="dash-archive-view-title"
            />
            <div className={dashboardPairedGridClass}>
              <DashboardRangePendingCard className={dashboardPairedColumnCardClass}>
                <div className={dashboardPairedColumnBodyClass}>
                  <h3 className={listLabelClass}>Top albums</h3>
                  {topAlbums.length === 0 ? (
                    <p className="font-mono text-caption uppercase tracking-[0.06em] text-warning">
                      [NO ALBUMS IN THIS WINDOW]
                    </p>
                  ) : (
                    <ul className={dashboardPairedColumnListClass}>
                      {topAlbums.map((al, index) => (
                        <li
                          key={al.album_id}
                          className={
                            index === topAlbums.length - 1 ? "" : "border-b border-hairline"
                          }
                        >
                          <div className="flex items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-5 sm:py-3">
                            <DashboardCoverThumb
                              musicbrainzReleaseMbid={al.musicbrainz_release_mbid}
                              lastfmCoverImageUrl={al.lastfm_cover_image_url}
                              alt={`${displayLabel(al.title, "Album")} · ${displayLabel(al.artist_name, "Artist")}`}
                            />
                            <div className="min-w-0 flex flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0 flex-1">
                                <p className="font-sans text-body text-foreground">
                                  {displayLabel(al.title, "[UNKNOWN ALBUM]")}
                                </p>
                                <p className="font-mono text-caption uppercase tracking-[0.04em] text-muted">
                                  {displayLabel(al.artist_name, "[UNKNOWN ARTIST]")}
                                </p>
                              </div>
                              <span className="shrink-0 font-mono text-body tabular-nums text-display sm:pl-2">
                                {formatCount(al.plays)}
                              </span>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </DashboardRangePendingCard>

              {recentTracksSlot}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
