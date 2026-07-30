/**
 * Shown when canonical listens exist but rollup tables are still being populated by the worker.
 */
export function DashboardStatsFoundationPendingBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-10 rounded-md border border-hairline bg-surface px-5 py-4 md:mb-12 md:px-6 md:py-5"
    >
      <p className="font-mono text-caption font-normal uppercase tracking-[0.1em] text-muted">
        Building your stats
      </p>
      <p className="mt-2 font-sans text-body text-foreground">
        We are synthesizing your listening history into the stats tables used on this dashboard.
        Hang tight — refresh in a moment if numbers still look empty.
      </p>
    </div>
  );
}
