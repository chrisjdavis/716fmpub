"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { memo, useEffect, useRef, useState } from "react";
import { LogoutForm } from "@/components/logout-form";

const PRIMARY_NAV: readonly { href: string; label: string }[] = [
  { href: "/dashboard", label: "Home" },
  { href: "/dashboard/explore", label: "Explore" },
  { href: "/dashboard/archive", label: "Archive" },
];

const MORE_NAV: readonly { href: string; label: string }[] = [
  { href: "/dashboard/imports", label: "Import" },
  { href: "/dashboard/export", label: "Export" },
  { href: "/dashboard/settings", label: "Settings" },
  { href: "/covenant", label: "Covenant" },
];

/** Shared motion for top-rail links (respects `prefers-reduced-motion`). */
const dashboardNavRailMotion =
  "motion-safe:transition-[color,transform,border-color] motion-safe:duration-200 motion-safe:ease-out " +
  "motion-safe:hover:-translate-y-px motion-safe:active:translate-y-0 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/45 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

function linkClass(active: boolean): string {
  return [
    "inline-flex items-center leading-none whitespace-nowrap border-b-2 pb-1 font-mono text-caption uppercase tracking-[0.1em] no-underline hover:no-underline",
    dashboardNavRailMotion,
    active
      ? "border-display text-display"
      : "border-transparent text-muted hover:text-foreground",
  ].join(" ");
}

function moreGroupActive(pathname: string): boolean {
  return MORE_NAV.some(
    ({ href }) => pathname === href || pathname.startsWith(`${href}/`),
  );
}

function moreItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isPrimaryActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  if (href === "/dashboard/explore") {
    return pathname === "/dashboard/explore" || pathname.startsWith("/dashboard/explore/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

const moreMenuLinkClass =
  "block w-full px-4 py-2.5 text-left font-mono text-caption uppercase tracking-[0.1em] no-underline hover:no-underline " +
  "transition-colors motion-safe:transition-[color,background-color,transform] motion-safe:duration-200 motion-safe:ease-out " +
  "motion-safe:hover:translate-x-px " +
  "focus-visible:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/35";

function AppPrimaryNavInner({ locked = false }: Readonly<{ locked?: boolean }>) {
  const pathname = usePathname() ?? "";
  const [moreOpen, setMoreOpen] = useState(false);
  const moreWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      const root = moreWrapRef.current;
      if (root && !root.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMoreOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  if (locked) {
    return (
      <nav
        className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-4 gap-y-2 sm:gap-x-6 md:gap-x-8"
        aria-label="Primary navigation"
      >
        <LogoutForm
          buttonClassName={`inline-flex items-center leading-none border-b-2 border-transparent pb-1 font-mono text-caption uppercase tracking-[0.1em] text-muted hover:text-foreground hover:no-underline ${dashboardNavRailMotion}`}
        />
      </nav>
    );
  }

  return (
    <nav
      className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-4 gap-y-2 sm:gap-x-6 md:gap-x-8"
      aria-label="Primary navigation"
    >
      {PRIMARY_NAV.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          prefetch
          className={linkClass(isPrimaryActive(pathname, href))}
        >
          {label}
        </Link>
      ))}

      <div ref={moreWrapRef} className="relative inline-flex shrink-0 items-center self-center">
        <button
          type="button"
          id="dashboard-more-trigger"
          aria-expanded={moreOpen}
          aria-haspopup="true"
          aria-controls="dashboard-more-menu"
          onClick={() => setMoreOpen((o) => !o)}
          className={[
            linkClass(moreGroupActive(pathname) || moreOpen),
            "cursor-pointer gap-1 bg-transparent p-0 font-inherit text-inherit",
          ].join(" ")}
        >
          <span>More</span>
          <span
            className={[
              "inline-block text-[0.7em] opacity-70 motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out",
              moreOpen ? "motion-safe:-rotate-180" : "",
            ].join(" ")}
            aria-hidden
          >
            ▾
          </span>
        </button>
        {moreOpen ? (
          <ul
            id="dashboard-more-menu"
            aria-labelledby="dashboard-more-trigger"
            className="absolute right-0 top-full z-50 mt-2 min-w-[12rem] rounded-md border border-hairline bg-surface py-1 shadow-lg motion-safe:animate-nav-menu-in motion-reduce:animate-none"
          >
            {MORE_NAV.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  prefetch
                  onClick={() => setMoreOpen(false)}
                  className={`${moreMenuLinkClass} ${
                    moreItemActive(pathname, href)
                      ? "bg-raised text-foreground"
                      : "text-muted hover:bg-raised hover:text-foreground"
                  }`}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <span className="hidden h-[1em] w-px shrink-0 bg-hairline sm:block" aria-hidden />
      <LogoutForm
        buttonClassName={`inline-flex items-center leading-none border-b-2 border-transparent pb-1 font-mono text-caption uppercase tracking-[0.1em] text-muted hover:text-foreground hover:no-underline ${dashboardNavRailMotion}`}
      />
    </nav>
  );
}

/** Memoized so soft navigations that re-render the dashboard shell do not rebuild nav links. */
export const AppPrimaryNav = memo(AppPrimaryNavInner);
