import Link from "next/link";
import type { ReactNode } from "react";
import { getServerSession } from "@/server/auth/get-server-session";
import { isPublicListeningHistoryEnabled } from "@/server/is-public-listening-history-enabled";
import {
  PUBLIC_ARCHIVE_PATH,
  PUBLIC_EXPLORE_PATH,
} from "@/server/listening-surface-routes";

function railLinkClass(active: boolean): string {
  return [
    "inline-flex items-center leading-none whitespace-nowrap border-b-2 pb-1 font-mono text-caption uppercase tracking-[0.1em] no-underline hover:no-underline",
    "motion-safe:transition-[color,transform,border-color] motion-safe:duration-200 motion-safe:ease-out",
    active
      ? "border-display text-display"
      : "border-transparent text-muted hover:text-foreground",
  ].join(" ");
}

const compactLinkClass =
  "text-interactive no-underline hover:underline";

const authLinkClass = "text-interactive no-underline hover:underline";

export type PublicSiteHeaderNavActive = "explore" | "archive" | null;

function CompactSlashNav({ items }: Readonly<{ items: readonly ReactNode[] }>) {
  if (items.length === 0) {
    return null;
  }
  return (
    <nav
      className="flex shrink-0 flex-wrap items-center justify-end gap-x-0 gap-y-2 font-mono text-caption uppercase tracking-[0.06em] text-muted"
      aria-label="Site"
    >
      {items.map((node, i) => (
        <span key={i} className="inline-flex items-center">
          {i > 0 ? (
            <span className="mx-2 text-faint" aria-hidden>
              /
            </span>
          ) : null}
          {node}
        </span>
      ))}
    </nav>
  );
}

/**
 * Header nav for public (non-dashboard) surfaces.
 * When listening history is public, Explore and Archive links are included.
 * Sign in lives in the global footer only — never in the header.
 */
export async function PublicSiteHeaderNav({
  active = null,
  variant = "rail",
}: Readonly<{
  active?: PublicSiteHeaderNavActive;
  /** `rail` — brand header underline links; `compact` — slash-separated style. */
  variant?: "rail" | "compact";
}>) {
  const [session, listeningPublic] = await Promise.all([
    getServerSession(),
    isPublicListeningHistoryEnabled(),
  ]);

  if (variant === "compact") {
    const items: ReactNode[] = [];
    if (listeningPublic) {
      items.push(
        <Link
          key="explore"
          href={PUBLIC_EXPLORE_PATH}
          className={compactLinkClass}
          aria-current={active === "explore" ? "page" : undefined}
        >
          Explore
        </Link>,
      );
      items.push(
        <Link
          key="archive"
          href={PUBLIC_ARCHIVE_PATH}
          className={compactLinkClass}
          aria-current={active === "archive" ? "page" : undefined}
        >
          Archive
        </Link>,
      );
    }
    if (session) {
      items.push(
        <Link key="dashboard" href="/dashboard" className={compactLinkClass}>
          Dashboard
        </Link>,
      );
    }
    return <CompactSlashNav items={items} />;
  }

  const hasLinks = listeningPublic || session;
  if (!hasLinks) {
    return null;
  }

  return (
    <nav
      className="flex min-w-0 flex-wrap items-center justify-end gap-x-5 gap-y-2"
      aria-label="Site"
    >
      {listeningPublic ? (
        <>
          <Link
            href={PUBLIC_EXPLORE_PATH}
            className={railLinkClass(active === "explore")}
            aria-current={active === "explore" ? "page" : undefined}
          >
            Explore
          </Link>
          <Link
            href={PUBLIC_ARCHIVE_PATH}
            className={railLinkClass(active === "archive")}
            aria-current={active === "archive" ? "page" : undefined}
          >
            Archive
          </Link>
        </>
      ) : null}
      {session ? (
        <Link
          href="/dashboard"
          className="inline-flex items-center font-mono text-caption uppercase tracking-[0.1em] text-interactive no-underline hover:underline"
        >
          Dashboard
        </Link>
      ) : null}
    </nav>
  );
}

/**
 * Slash-separated Explore / Archive prefix for auth page headers (before Home / …).
 * Renders nothing when public listening is off.
 */
export async function PublicListeningAuthNavPrefix() {
  const listeningPublic = await isPublicListeningHistoryEnabled();
  if (!listeningPublic) {
    return null;
  }
  return (
    <>
      <Link href={PUBLIC_EXPLORE_PATH} className={authLinkClass}>
        Explore
      </Link>
      <span className="mx-2 text-faint" aria-hidden>
        /
      </span>
      <Link href={PUBLIC_ARCHIVE_PATH} className={authLinkClass}>
        Archive
      </Link>
      <span className="mx-2 text-faint" aria-hidden>
        /
      </span>
    </>
  );
}

/**
 * Home landing topbar: Explore / Archive when public; optional first-run Set up.
 * Sign in is footer-only.
 */
export async function PublicHomeTopbarActions({
  linkClassName,
  setupHref,
}: Readonly<{
  linkClassName: string;
  /** When set (unconfigured instance), show Set up in the topbar. */
  setupHref?: string;
}>) {
  const listeningPublic = await isPublicListeningHistoryEnabled();
  const showAnything = listeningPublic || setupHref;
  if (!showAnything) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
      {listeningPublic ? (
        <>
          <Link href={PUBLIC_EXPLORE_PATH} className={linkClassName}>
            Explore
          </Link>
          <Link href={PUBLIC_ARCHIVE_PATH} className={linkClassName}>
            Archive
          </Link>
        </>
      ) : null}
      {setupHref ? (
        <Link href={setupHref} className={linkClassName}>
          Set up
        </Link>
      ) : null}
    </div>
  );
}
