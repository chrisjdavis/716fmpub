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
 */
export async function PublicSiteHeaderNav({
  active = null,
  variant = "rail",
}: Readonly<{
  active?: PublicSiteHeaderNavActive;
  /** `rail` — brand header underline links; `compact` — slash-separated legal/auth style. */
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
    } else {
      items.push(
        <Link key="login" href="/login" className={compactLinkClass}>
          Sign in
        </Link>,
      );
    }
    return <CompactSlashNav items={items} />;
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
      ) : (
        <Link
          href="/login"
          className="inline-flex items-center font-mono text-caption uppercase tracking-[0.1em] text-interactive no-underline hover:underline"
        >
          Sign in
        </Link>
      )}
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
 * Home landing topbar actions: Explore / Archive (when public) + primary CTA.
 */
export async function PublicHomeTopbarActions({
  primaryHref,
  primaryLabel,
  linkClassName,
}: Readonly<{
  primaryHref: string;
  primaryLabel: string;
  linkClassName: string;
}>) {
  const listeningPublic = await isPublicListeningHistoryEnabled();
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
      <Link href={primaryHref} className={linkClassName}>
        {primaryLabel}
      </Link>
    </div>
  );
}
