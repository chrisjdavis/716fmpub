import Link from "next/link";
import type { DashboardHomeBriefing } from "@/server/dashboard-home-briefing";
import { DashboardListeningInsightsAdvancedGate } from "./dashboard-listening-insights-advanced-gate";
import { DashboardStatsFoundationPendingBanner } from "./dashboard-stats-foundation-pending-banner";
import styles from "./dashboard-conversational-home.module.css";

export function DashboardConversationalHome({
  briefing,
  statsFoundationPending = false,
  allowAiLayer1Reads,
}: Readonly<{
  briefing: DashboardHomeBriefing;
  statsFoundationPending?: boolean;
  allowAiLayer1Reads: boolean;
}>) {
  const hasInsights = briefing.secondaryInsights.length > 0;
  const hasYesterday = briefing.yesterdaySnapshot != null;
  const hasMiddle = hasInsights || hasYesterday;

  return (
    <div className={styles.canvas}>
      {allowAiLayer1Reads && statsFoundationPending ? <DashboardStatsFoundationPendingBanner /> : null}
      <header className={styles.greeting}>
        <p className={styles.eyebrow}>HOME</p>
        <h1 className={styles.headline}>{briefing.greetingLine1}</h1>
        <p className={styles.dateLine}>{briefing.dateHeadline}</p>
        {briefing.calendarFootnote.trim().length > 0 ? (
          <p className={styles.calendarNote}>{briefing.calendarFootnote}</p>
        ) : null}
      </header>

      {!allowAiLayer1Reads ? (
        <DashboardListeningInsightsAdvancedGate variant="home" statsFoundationPending={statsFoundationPending} />
      ) : null}

      {allowAiLayer1Reads && briefing.narrativeParagraphs.length > 0 ? (
        <section
          className={`${styles.narrative} ${hasMiddle ? styles.narrativeGap32 : styles.narrativeGap36}`}
          aria-label="Listening update"
        >
          <p className={styles.narrativeParagraph}>
            {briefing.narrativeParagraphs.flatMap((para, pi) => [
              ...(pi > 0 ? [" "] : []),
              ...para.map((seg, si) =>
                seg.kind === "accent" ? (
                  <strong key={`${pi}-${si}`} className={styles.accent}>
                    {seg.text}
                  </strong>
                ) : (
                  <span key={`${pi}-${si}`}>{seg.text}</span>
                ),
              ),
            ])}
          </p>
        </section>
      ) : null}

      {allowAiLayer1Reads && hasMiddle ? (
        <div className={styles.middleWrap}>
          {hasInsights ? (
            <div className={styles.insights}>
              {briefing.secondaryInsights.map((row, i) => (
                <div key={`${i}-${row.tag}`} className={styles.insightRow}>
                  <p className={styles.insightTag}>{row.tag}</p>
                  <p className={styles.insightSentence}>{row.sentence}</p>
                </div>
              ))}
            </div>
          ) : null}
          {hasYesterday && briefing.yesterdaySnapshot ? (
            <section className={styles.yesterdayBlock} aria-label="Yesterday">
              <p className={styles.yesterdayLabel}>YESTERDAY</p>
              <p className={styles.yesterdayBody}>{briefing.yesterdaySnapshot.body}</p>
            </section>
          ) : null}
        </div>
      ) : null}

      <div className={styles.cardRow}>
        {allowAiLayer1Reads
          ? briefing.cards.map((card) => (
          <article key={card.kicker} className={styles.card}>
            <p className={styles.cardLabel}>{card.kicker}</p>
            <p className={styles.cardValue}>{card.title}</p>
            {card.detail ? <p className={styles.cardMeta}>{card.detail}</p> : null}
          </article>
        ))
          : null}
      </div>

      <nav className={styles.actions} aria-label="Suggested actions">
        {allowAiLayer1Reads
          ? briefing.actions.map((a, i) => (
          <Link key={`${i}-${a.label}`} href={a.href} prefetch className={styles.action}>
            {a.label}
          </Link>
        ))
          : null}
      </nav>
    </div>
  );
}
