import styles from "./dashboard-conversational-home.module.css";

const pulse = "rounded-md bg-muted/20 motion-reduce:animate-none animate-pulse";
const pulseSoft = "rounded-md bg-muted/15 motion-reduce:animate-none animate-pulse";

/**
 * Shown while deferred home briefing streams.
 * Mirrors {@link DashboardConversationalHome} — greeting, narrative, insights + yesterday, cards, actions.
 */
export function DashboardHomeShellFallback() {
  return (
    <div
      className={styles.canvas}
      aria-busy="true"
      aria-live="polite"
      aria-label="Home briefing loading"
    >
      <header className={styles.greeting}>
        <p className={styles.eyebrow}>HOME</p>
        <h1 className="sr-only">Dashboard home loading</h1>
        <div className="space-y-3" aria-hidden>
          <div className={`h-10 w-[min(100%,22rem)] md:h-14 md:w-[min(100%,32rem)] ${pulse}`} />
          <div className={`h-10 w-[min(100%,16rem)] md:h-14 md:w-[min(100%,24rem)] ${pulseSoft}`} />
        </div>
        <div className={`mt-4 h-7 w-[min(100%,28rem)] md:h-8 ${pulseSoft}`} aria-hidden />
        <div className={`mt-2.5 h-3 w-56 max-w-full ${pulseSoft}`} aria-hidden />
      </header>

      <section className={`${styles.narrative} ${styles.narrativeGap32}`} aria-label="Listening update">
        <div className={styles.narrativeParagraph} aria-hidden>
          <span className={`mb-3 block h-[1.1em] w-full max-w-[58ch] ${pulse}`} />
          <span className={`mb-3 block h-[1.1em] w-full max-w-[52ch] ${pulseSoft}`} />
          <span className={`block h-[1.1em] w-full max-w-[40ch] ${pulseSoft}`} />
        </div>
      </section>

      <div className={styles.middleWrap} aria-hidden>
        <div className={styles.insights}>
          {[0, 1].map((i) => (
            <div key={i} className={styles.insightRow}>
              <div className={`mb-1.5 h-3 w-28 ${pulseSoft}`} />
              <div className={`h-5 w-full max-w-xl ${pulse}`} />
            </div>
          ))}
        </div>
        <section className={styles.yesterdayBlock} aria-label="Yesterday">
          <div className={`mb-2 h-3 w-24 ${pulseSoft}`} />
          <div className={`h-5 w-full max-w-lg ${pulse}`} />
        </section>
      </div>

      <div className={styles.cardRow}>
        {[0, 1, 2].map((i) => (
          <article key={i} className={`${styles.card} ${styles.skeletonCard}`} aria-hidden>
            <div className={`h-3 w-28 ${pulseSoft}`} />
            <div className={`mt-3 h-8 w-[92%] max-w-[14rem] ${pulse}`} />
            <div className={`mt-2 h-4 w-full max-w-[12rem] ${pulseSoft}`} />
          </article>
        ))}
      </div>

      <nav className={styles.actions} aria-label="Suggested actions">
        <span
          className={`${styles.action} pointer-events-none min-w-[11rem] select-none sm:min-w-[12rem]`}
          aria-hidden
        >
          &nbsp;
        </span>
        <span
          className={`${styles.action} pointer-events-none min-w-[9rem] select-none sm:min-w-[10rem]`}
          aria-hidden
        >
          &nbsp;
        </span>
        <span
          className={`${styles.action} pointer-events-none min-w-[8rem] select-none sm:min-w-[9rem]`}
          aria-hidden
        >
          &nbsp;
        </span>
      </nav>
    </div>
  );
}
