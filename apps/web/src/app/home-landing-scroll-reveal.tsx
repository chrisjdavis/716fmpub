"use client";

import { useLayoutEffect } from "react";
import styles from "./home-landing.module.css";

function isInRevealBand(el: HTMLElement, vh: number): boolean {
  const r = el.getBoundingClientRect();
  return r.top < vh * 0.9 && r.bottom > vh * 0.12;
}

/**
 * Scroll-linked section reveals for the marketing home. CSS `view()` timelines are
 * unreliable here (nested flex / scrollport), so we use IntersectionObserver + transitions.
 * In-view blocks use `@starting-style` (CSS) so they animate without a blank “pending” frame.
 */
export function HomeLandingScrollReveal() {
  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-landing-reveal-root]");
    if (!root) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.setAttribute("data-landing-reveal-live", "reduced");
      return;
    }

    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-landing-reveal]"));
    if (nodes.length === 0) return;

    const vh = window.innerHeight;

    root.setAttribute("data-landing-reveal-live", "yes");
    for (const el of nodes) {
      if (isInRevealBand(el, vh)) {
        el.classList.add(styles.landingRevealOn);
        el.classList.remove(styles.landingRevealPending);
      } else {
        el.classList.add(styles.landingRevealPending);
        el.classList.remove(styles.landingRevealOn);
      }
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const ent of entries) {
          if (!ent.isIntersecting) continue;
          const t = ent.target as HTMLElement;
          t.classList.remove(styles.landingRevealPending);
          t.classList.add(styles.landingRevealOn);
          io.unobserve(t);
        }
      },
      { root: null, rootMargin: "0px 0px -10% 0px", threshold: 0.06 },
    );

    for (const el of nodes) {
      if (el.classList.contains(styles.landingRevealPending)) {
        io.observe(el);
      }
    }

    return () => {
      io.disconnect();
      for (const el of nodes) {
        el.classList.remove(styles.landingRevealPending, styles.landingRevealOn);
      }
      root.removeAttribute("data-landing-reveal-live");
    };
  }, []);

  return null;
}
