import Link from "next/link";
import type { TimeMachineExploreAnchorStrip } from "@/server/time-machine-explore-visuals";
import { DashboardTimeMachineAnchorCover } from "./dashboard-time-machine-anchor-cover";
import styles from "./dashboard-time-machine-explore.module.css";

function coverAlt(item: TimeMachineExploreAnchorStrip["items"][number]): string {
  if (item.subtitle) {
    return `${item.title} — ${item.subtitle}`;
  }
  return item.title;
}

export function DashboardTimeMachineAnchorStrip({
  strip,
}: Readonly<{
  strip: TimeMachineExploreAnchorStrip;
}>) {
  if (strip.items.length === 0) {
    return null;
  }

  return (
    <div className={styles.anchorStrip} aria-label={strip.label}>
      <div className={styles.anchorStripLabelBlock}>
        <p className={`${styles.anchorStripLabel} font-mono text-[11px] font-normal uppercase tracking-[0.24em] text-muted`}>
          {strip.label}
        </p>
        {strip.subtitle ? (
          <p className={`${styles.anchorStripSubtitle} font-sans text-[13px] leading-5 text-muted`}>{strip.subtitle}</p>
        ) : null}
      </div>
      <ul className={styles.anchorStripCovers}>
        {strip.items.map((item, idx) => {
          const alt = coverAlt(item);
          const href = item.archiveHref ?? undefined;
          const cell = (
            <DashboardTimeMachineAnchorCover
              key={`${idx}:${item.imageUrl ?? ""}:${item.title}`}
              imageUrl={item.imageUrl}
              alt={alt}
            />
          );
          return (
            <li key={`${item.title}-${idx}`} className={styles.anchorStripItem}>
              {href ? (
                <Link
                  href={href}
                  className={styles.anchorCoverButton}
                  title={`${item.title}${item.subtitle ? ` — ${item.subtitle}` : ""}`}
                  aria-label={alt}
                >
                  {cell}
                </Link>
              ) : (
                <span
                  className={styles.anchorCoverStatic}
                  title={`${item.title}${item.subtitle ? ` — ${item.subtitle}` : ""}`}
                  aria-label={alt}
                  role="img"
                >
                  {cell}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
