"use client";

import Link from "next/link";
import { DashboardStatsFoundationPendingBanner } from "./dashboard-stats-foundation-pending-banner";

export type DashboardListeningInsightsAdvancedGateVariant = "explore" | "home" | "archive";

const VARIANT_COPY: Readonly<
  Record<
    DashboardListeningInsightsAdvancedGateVariant,
    Readonly<{
      eyebrow: string;
      title: string;
      body: string;
      links: readonly { href: string; label: string }[];
    }>
  >
> = {
  explore: {
    eyebrow: "Advanced plan",
    title: "Musical Time Machine is available on Advanced",
    body: "Month narratives, timeline eras, and supporting listening insights on this surface require an Advanced subscription. Your canonical plays and the full archive remain available on Core.",
    links: [
      { href: "/dashboard/archive", label: "Open listening archive" },
      { href: "/dashboard", label: "Back to home" },
    ],
  },
  home: {
    eyebrow: "Advanced plan",
    title: "Listening insights are available on Advanced",
    body: "Your personalized home briefing, comparisons, and bundled listening rollups require an Advanced subscription. Your import and the listening archive remain available on Core.",
    links: [
      { href: "/dashboard/archive", label: "Open listening archive" },
      { href: "/dashboard/explore", label: "Musical Time Machine (Advanced)" },
    ],
  },
  archive: {
    eyebrow: "Advanced plan",
    title: "Window highlights are available on Advanced",
    body: "Top album and top artist cards for the selected window use the same Advanced-gated listening summary as your home briefing. Tape play totals still use canonical listens on Core.",
    links: [
      { href: "/dashboard", label: "Back to home" },
      { href: "/dashboard/explore", label: "Musical Time Machine (Advanced)" },
    ],
  },
};

export function DashboardListeningInsightsAdvancedGate({
  variant,
  statsFoundationPending = false,
}: Readonly<{
  variant: DashboardListeningInsightsAdvancedGateVariant;
  statsFoundationPending?: boolean;
}>) {
  const { eyebrow, title, body, links } = VARIANT_COPY[variant];
  return (
    <div className="flex flex-col gap-6">
      {statsFoundationPending ? <DashboardStatsFoundationPendingBanner /> : null}
      <div className="rounded-md border border-hairline bg-surface px-6 py-8">
        <p className="font-mono text-caption uppercase tracking-[0.08em] text-overline">{eyebrow}</p>
        <h2 className="mt-2 font-display text-2xl font-normal tracking-tight text-foreground md:text-3xl">
          {title}
        </h2>
        <p className="mt-3 max-w-[65ch] font-sans text-body text-muted">{body}</p>
        <nav className="mt-6 flex flex-wrap gap-4" aria-label="Alternatives">
          {links.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              prefetch
              className="font-mono text-label uppercase tracking-[0.08em] text-interactive underline-offset-4 hover:underline"
            >
              {a.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
