import styles from "./dashboard-time-machine-explore.module.css";

const pulseBar = "rounded-md bg-muted/20 motion-reduce:animate-none animate-pulse";
const pulseSoft = "rounded-md bg-muted/15 motion-reduce:animate-none animate-pulse";

/**
 * Shown while deferred Musical Time Machine / explore payload streams.
 * Mirrors {@link DashboardTimeMachineExplore} shell (hero → scrubber → month block → cards → narratives).
 */
export function DashboardStatsShellFallback() {
  return (
    <div
      className={`${styles.canvas} ${styles.canvasStack} w-full min-w-0 max-w-none`}
      aria-busy="true"
      aria-live="polite"
      aria-label="Explore loading"
    >
      <section aria-labelledby="explore-fallback-title" className="w-full space-y-5">
        <p className="font-mono text-label uppercase tracking-[0.24em] text-overline">Explore</p>
        <h1 id="explore-fallback-title" className="sr-only">
          Your musical time machine
        </h1>
        <div className="w-full max-w-none space-y-3" aria-hidden>
          <div className={`h-9 w-[min(100%,20rem)] md:h-12 md:w-[min(100%,36rem)] ${pulseBar}`} />
          <div className={`h-9 w-[min(100%,14rem)] md:h-12 md:w-[min(100%,28rem)] ${pulseSoft}`} />
        </div>
        <div className={`h-6 max-w-xl ${pulseSoft}`} aria-hidden />
      </section>

      <div className={styles.timelineAndPeriod}>
        <section aria-label="Listening timeline" className="w-full">
          <div className="flex w-full min-w-0 flex-col gap-0">
            <div className="flex h-9 flex-wrap items-start justify-between gap-3">
              <p className="font-mono text-label font-normal uppercase tracking-[0.24em] text-overline">
                Timeline
              </p>
              <div className="flex flex-wrap gap-2.5" aria-hidden>
                <div className="h-9 w-[4.5rem] rounded-md border border-hairline bg-surface/80" />
                <div className="h-9 w-[4.5rem] rounded-md border border-hairline bg-surface/80" />
              </div>
            </div>

            <div
              className="mt-6 flex h-5 w-full items-center justify-between px-0.5"
              aria-hidden
            >
              {[2018, 2019, 2020, 2021, 2022, 2023].map((y) => (
                <span key={y} className={`h-3 w-8 ${pulseSoft}`} />
              ))}
            </div>

            <div className="mt-3 w-full min-w-0" aria-hidden>
              <div
                className={`relative h-[52px] w-full overflow-hidden rounded-md border border-hairline bg-surface sm:h-[60px] ${pulseBar}`}
              />
            </div>

            <div className="relative mt-2 flex w-full items-center py-1" aria-hidden>
              <div className="h-[8px] w-full rounded-full bg-muted/25 shadow-[inset_0_0_0_1px_var(--border-visible)]" />
            </div>

            <div className={`mt-2 h-5 max-w-[65ch] ${pulseSoft}`} aria-hidden />
          </div>
        </section>

        <div className={styles.bodyAfterTimeline}>
          <section aria-labelledby="explore-fallback-period" className={`${styles.periodStack} w-full`}>
            <div className={styles.periodTightStack}>
              <div className={styles.periodHeaderRow}>
                <h2
                  id="explore-fallback-period"
                  className="sr-only"
                >
                  Selected month
                </h2>
                <div
                  className={`min-h-[2.5rem] min-w-0 flex-1 md:min-h-[4rem] ${pulseBar}`}
                  aria-hidden
                />
                <div
                  className="h-10 w-44 max-w-[40%] shrink-0 rounded-md border border-brand/40 bg-brand/25 sm:w-52"
                  aria-hidden
                />
              </div>
              <div className={`h-4 w-full max-w-4xl ${pulseSoft}`} aria-hidden />
            </div>

            <div className={styles.periodTightStack}>
              <div className={`h-8 max-w-[65ch] ${pulseBar}`} aria-hidden />
              <div
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-[18px] lg:grid-cols-3"
                aria-hidden
              >
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="flex min-h-[148px] w-full flex-col rounded-md border border-hairline bg-surface p-5"
                  >
                    <div className={`mb-3 h-3 w-24 ${pulseSoft}`} />
                    <div className={`mb-2 h-7 w-[85%] max-w-[240px] ${pulseBar}`} />
                    <div className={`mt-auto h-4 w-full ${pulseSoft}`} />
                  </div>
                ))}
              </div>
            </div>
          </section>

          <div className={`${styles.exploreLower} w-full min-w-0 max-w-none`} aria-hidden>
            <div className={`h-6 max-w-[65ch] ${pulseBar}`} />
            <div className={`mt-5 h-6 max-w-[60ch] ${pulseSoft}`} />
            <div className={`mt-5 h-6 max-w-[58ch] ${pulseSoft}`} />
          </div>
        </div>
      </div>
    </div>
  );
}
