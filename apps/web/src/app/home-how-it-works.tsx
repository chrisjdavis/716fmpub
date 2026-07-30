"use client";

import { Fragment, useEffect, useId, useState, type KeyboardEvent } from "react";
import styles from "./home-how-it-works.module.css";

const STEPS = [
  {
    id: "connect",
    indexLabel: "01",
    title: "Connect Last.fm or upload your history",
  },
  {
    id: "organize",
    indexLabel: "02",
    title: "We organize and clean your archive",
  },
  {
    id: "explore",
    indexLabel: "03",
    title: "Explore your data and export everything anytime",
  },
] as const;

const IMPORT_SEGMENTS = ["Connect", "Import", "Review", "Unlock"] as const;

const ORG_ROWS = [
  { title: "Stereolab — Emperor Tomato Ketchup", meta: "raw page", dup: false, clean: false },
  { title: "Stereolab — Emperor Tomato Ketchup", meta: "duplicate", dup: true, clean: false },
  { title: "Broadcast — Tender Buttons", meta: "aligned", dup: false, clean: true },
] as const;

function ImportPreview() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return undefined;
    const t = window.setInterval(() => {
      setPhase((p) => (p + 1) % IMPORT_SEGMENTS.length);
    }, 850);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className={styles.previewShell} aria-hidden>
      <p className={styles.previewKicker}>Import</p>
      <p className={styles.previewTitle}>Queue Last.fm import</p>
      <div className={styles.importSourceRow}>
        <span className={styles.importBadge}>Last.fm</span>
      </div>
      <div className={styles.importUserField}>listener716</div>
      <div className={styles.importPipeline}>
        {IMPORT_SEGMENTS.map((word, i) => (
          <Fragment key={word}>
            {i > 0 ? (
              <span className={styles.importArrow} aria-hidden>
                →
              </span>
            ) : null}
            <span
              className={`${styles.importPipeWord} ${phase === i ? styles.importPipeWordLit : ""}`}
            >
              {word}
            </span>
          </Fragment>
        ))}
      </div>
      <div className={styles.importSegments}>
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className={styles.importSeg} />
        ))}
      </div>
      <span className={styles.importFakeCta}>Queue Last.fm import</span>
      <p className={styles.previewDemoNote}>Illustration only — not live import timing.</p>
    </div>
  );
}

function OrganizePreview() {
  return (
    <div className={styles.previewShell} aria-hidden>
      <p className={styles.previewKicker}>Archive</p>
      <p className={styles.previewTitle}>Normalize listens</p>
      <p className={styles.orgCaption}>Deduplicate · sort chronologically · fix gaps</p>
      <div className={styles.orgRows}>
        {ORG_ROWS.map((row, idx) => (
          <div
            key={idx}
            className={`${styles.orgRow} ${row.dup ? styles.orgRowDup : ""} ${row.clean ? styles.orgRowMain : ""}`}
          >
            <span>{row.title}</span>
            <span className={styles.orgMeta}>{row.meta}</span>
          </div>
        ))}
      </div>
      <div className={styles.orgCheck}>
        <span aria-hidden>✓</span> Ready for stats
      </div>
    </div>
  );
}

function ExplorePreview() {
  return (
    <div className={styles.previewShell} aria-hidden>
      <p className={styles.previewKicker}>Explore</p>
      <p className={styles.previewTitle}>Your archive, any range</p>
      <p className={styles.exRange}>Last 30 days · plays over time</p>
      <div className={styles.exBars}>
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className={styles.exBar} />
        ))}
      </div>
      <div className={styles.exExportRow}>
        <span className={styles.exExportLabel}>Export</span>
        <span className={styles.exChip}>JSON</span>
        <span className={styles.exChip}>CSV</span>
      </div>
    </div>
  );
}

export function HomeHowItWorks() {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const tabPrefix = `${baseId}-tab`;
  const panelPrefix = `${baseId}-panel`;

  function focusTab(index: number) {
    window.requestAnimationFrame(() => {
      document.getElementById(`${tabPrefix}-${index}`)?.focus();
    });
  }

  function goToTab(next: number) {
    const clamped = (next + STEPS.length) % STEPS.length;
    setActive(clamped);
    focusTab(clamped);
  }

  function onTabKeyDown(i: number, e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      goToTab(i + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      goToTab(i - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      goToTab(0);
    } else if (e.key === "End") {
      e.preventDefault();
      goToTab(STEPS.length - 1);
    }
  }

  return (
    <div className={styles.hiwGrid}>
      <div>
        <ul className={styles.stepList} role="tablist" aria-label="How it works steps">
          {STEPS.map((step, i) => {
            const selected = active === i;
            return (
              <li key={step.id} role="presentation">
                <button
                  type="button"
                  role="tab"
                  id={`${tabPrefix}-${i}`}
                  aria-selected={selected}
                  aria-controls={`${panelPrefix}-${i}`}
                  tabIndex={selected ? 0 : -1}
                  className={`${styles.stepButton} ${selected ? styles.stepButtonActive : ""}`}
                  onClick={() => setActive(i)}
                  onKeyDown={(e) => onTabKeyDown(i, e)}
                >
                  <span className={styles.stepIndex}>{step.indexLabel}</span>
                  <span className={styles.stepTitle}>{step.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className={styles.previewColumn}>
        {STEPS.map((step, i) => (
          <div
            key={step.id}
            id={`${panelPrefix}-${i}`}
            role="tabpanel"
            hidden={active !== i}
            aria-labelledby={`${tabPrefix}-${i}`}
          >
            {active === i ? (
              i === 0 ? (
                <ImportPreview />
              ) : i === 1 ? (
                <OrganizePreview />
              ) : (
                <ExplorePreview />
              )
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
