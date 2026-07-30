import Link from "next/link";
import { sanitizeRemoteCoverImageUrl } from "@vs/domain/import/lastfm-cover-image-url";
import type { TimeMachineExploreModel } from "@/server/load-time-machine-explore";
import { exploreNarrativePlainText } from "@/server/time-machine-explore-narrative";
import { DashboardExploreNarrativeParagraph } from "./dashboard-explore-narrative-paragraph";
import { DashboardStatsFoundationPendingBanner } from "./dashboard-stats-foundation-pending-banner";
import { DashboardTimeMachineAnchorStrip } from "./dashboard-time-machine-anchor-strip";
import { DashboardTimeMachineScrubber } from "./dashboard-time-machine-scrubber";
import styles from "./dashboard-time-machine-explore.module.css";

const moduleTagClass =
  "mb-3 font-mono text-label font-normal uppercase tracking-[0.24em] text-overline";
const moduleValueClass =
  "mb-2 font-sans text-xl font-medium leading-[28px] text-foreground md:text-2xl md:leading-[32px]";
const moduleMetaClass = "font-sans text-base leading-[26px] text-muted";

export function DashboardTimeMachineExplore({
  model,
  statsFoundationPending,
  explorePath = "/dashboard/explore",
  archivePath = "/dashboard/archive",
}: Readonly<{
  model: TimeMachineExploreModel;
  statsFoundationPending: boolean;
  explorePath?: string;
  archivePath?: string;
}>) {
  const { copy, anchorStrip } = model;
  const archiveHref = `${archivePath}?month=${encodeURIComponent(model.monthYyyMm)}`;
  const hasLowerBody =
    Boolean(exploreNarrativePlainText(copy.primaryNarrative).trim()) ||
    Boolean(exploreNarrativePlainText(copy.comparisonNarrative).trim()) ||
    Boolean(exploreNarrativePlainText(copy.continuityNarrative).trim()) ||
    copy.detailLines.length > 0;

  return (
    <div className={`${styles.canvas} ${styles.canvasStack} w-full min-w-0 max-w-none`}>
      {statsFoundationPending ? <DashboardStatsFoundationPendingBanner /> : null}

      <section aria-labelledby="time-machine-title" className="w-full space-y-5">
        <p className="font-mono text-label uppercase tracking-[0.24em] text-overline">Explore</p>
        <h1
          id="time-machine-title"
          className="w-full max-w-none font-display text-[2.625rem] font-normal leading-[2.875rem] tracking-tight text-foreground md:text-[4.5rem] md:leading-[4.75rem]"
        >
          Your musical time machine
        </h1>
        <p className="w-full max-w-none font-sans text-lg leading-3 leading-relaxed text-muted">
          Scrub the timeline. Each month reveals a different fingerprint from your history.
        </p>
      </section>

      <div className={styles.timelineAndPeriod}>
        <section aria-label="Listening timeline" className="w-full">
          <DashboardTimeMachineScrubber
            timeline={model.timeline}
            selectedMonth={model.monthYyyMm}
            timelineView={model.timelineView}
            explorePath={explorePath}
          />
        </section>

        <div key={model.monthYyyMm} className={styles.bodyAfterTimeline}>
        <section aria-labelledby="active-period-heading" className={`${styles.periodStack} w-full`}>
          <div className={styles.periodTightStack}>
            <div className={styles.periodHeaderRow}>
              <h2
                id="active-period-heading"
                className="min-w-0 flex-1 font-display text-[2.5rem] font-normal leading-[2.625rem] tracking-tight text-foreground md:text-[4rem] md:leading-[4.125rem]"
              >
                {copy.periodLabel}
              </h2>
              <Link
                href={archiveHref}
                className={`${styles.archiveCta} ${
                  model.timelineView === "new-music" ? styles.archiveCtaNewMusic : ""
                } inline-flex h-10 shrink-0 items-center justify-center rounded-md border px-4 font-sans text-base font-medium no-underline hover:no-underline ${
                  model.timelineView === "new-music"
                    ? "border-[rgb(37_99_235)] bg-[rgb(37_99_235)] text-white hover:text-white hover:bg-[rgb(37_99_235)]/92"
                    : "border-brand bg-brand text-neutral-950"
                }`}
              >
                Open this month in archive
              </Link>
            </div>
            {copy.contextStrip.length > 0 ? (
              <div
                className={`${styles.contextStrip} min-w-0 w-full overflow-x-auto`}
                aria-label="Month context"
              >
                <p className="m-0 whitespace-nowrap font-sans text-base leading-relaxed text-muted">
                  {copy.contextStrip.join(" ")}
                </p>
              </div>
            ) : null}
          </div>
          {copy.summaryLine || anchorStrip || copy.modules.length > 0 ? (
            <div className={`${styles.periodTightStack} ${styles.summaryAnchorCardsFlow}`}>
              {copy.summaryLine ? (
                <p className="max-w-[65ch] font-sans text-2xl font-normal leading-[2.125rem] text-foreground md:text-[1.75rem] md:leading-10">
                  {copy.summaryLine}
                </p>
              ) : null}
              {anchorStrip ? <DashboardTimeMachineAnchorStrip strip={anchorStrip} /> : null}
              {copy.modules.length > 0 ? (
                <section aria-label="Supporting insights" className="w-full">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-[18px] lg:grid-cols-3">
                    {copy.modules.map((mod, i) => (
                      <div
                        key={`${mod.tagKey}-${mod.tag}-${i}`}
                        className={`${styles.moduleCard} min-h-[148px] w-full rounded-md border border-hairline bg-surface p-5`}
                      >
                        {mod.imageUrl && sanitizeRemoteCoverImageUrl(mod.imageUrl) ? (
                          <div className={styles.moduleCardWithArt}>
                            {/* eslint-disable-next-line @next/next/no-img-element -- remote Last.fm CDN */}
                            <img
                              src={sanitizeRemoteCoverImageUrl(mod.imageUrl)!}
                              alt={mod.imageAlt ?? ""}
                              width={56}
                              height={56}
                              className={styles.moduleCardArt}
                              loading="eager"
                            />
                            <div className={styles.moduleCardTextCol}>
                              <p className={`${moduleTagClass} mb-2 md:mb-3`}>{mod.tag}</p>
                              <p className={moduleValueClass}>{mod.value}</p>
                              <p className={moduleMetaClass}>{mod.meta}</p>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className={moduleTagClass}>{mod.tag}</p>
                            <p className={moduleValueClass}>{mod.value}</p>
                            <p className={moduleMetaClass}>{mod.meta}</p>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
        </section>

        {hasLowerBody ? (
          <div className={`${styles.exploreLower} w-full min-w-0 max-w-none`}>
            {copy.primaryNarrative && exploreNarrativePlainText(copy.primaryNarrative).trim() ? (
              <DashboardExploreNarrativeParagraph
                paragraph={copy.primaryNarrative}
                className={`${styles.explorePrimaryNarrative} m-0 max-w-[65ch] font-sans text-xl leading-8 text-foreground md:text-2xl md:leading-[38px]`}
              />
            ) : null}

            {copy.comparisonNarrative && exploreNarrativePlainText(copy.comparisonNarrative).trim() ? (
              <DashboardExploreNarrativeParagraph
                paragraph={copy.comparisonNarrative}
                className={`${styles.exploreComparisonNarrative} m-0 max-w-[65ch] font-sans text-xl leading-8 text-foreground md:text-2xl md:leading-[38px]`}
              />
            ) : null}

            {copy.continuityNarrative && exploreNarrativePlainText(copy.continuityNarrative).trim() ? (
              <DashboardExploreNarrativeParagraph
                paragraph={copy.continuityNarrative}
                className={`${styles.exploreContinuityNarrative} m-0 max-w-[65ch] font-sans text-xl font-medium leading-8 text-foreground md:text-2xl md:leading-[38px]`}
              />
            ) : null}

            {copy.detailLines.length > 0 ? (
              <details className={styles.exploreDetails}>
                <summary className="cursor-pointer font-sans text-base text-muted underline-offset-2 hover:text-foreground hover:underline">
                  View detailed breakdown
                </summary>
                <div className="mt-3 max-w-[65ch] space-y-2 border-t border-hairline pt-3 font-sans text-base leading-relaxed text-muted">
                  {copy.detailLines.map((line, i) => (
                    <p key={i} className="m-0">
                      {line}
                    </p>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
        </div>
      </div>
    </div>
  );
}
