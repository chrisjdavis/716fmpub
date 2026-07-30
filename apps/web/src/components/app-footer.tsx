"use client";

import Link from "next/link";

const footerLinkClass =
  "rounded-sm text-interactive no-underline hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export function AppFooter() {
  return (
    <footer
      className="border-t border-hairline px-4 py-8 text-center font-mono text-caption text-muted"
      role="contentinfo"
    >
      <p className="m-0 flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
        <Link href="/covenant" className={footerLinkClass}>
          The 716FM Covenant
        </Link>
        <span className="text-faint" aria-hidden>
          ·
        </span>
        <Link href="/login" className={footerLinkClass}>
          Sign in
        </Link>
        <span className="text-faint" aria-hidden>
          ·
        </span>
        <Link href="/terms" className={footerLinkClass}>
          Terms
        </Link>
        <span className="text-faint" aria-hidden>
          ·
        </span>
        <Link href="/privacy" className={footerLinkClass}>
          Privacy
        </Link>
        <span className="hidden text-faint sm:inline" aria-hidden>
          ·
        </span>
        <span className="w-full text-center sm:w-auto sm:text-left">
          © 2024 - 2026 716 Ventures, LLC. Open source (MIT).
        </span>
      </p>
    </footer>
  );
}
