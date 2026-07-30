import Link from "next/link";
import { getServerSession } from "@/server/auth/get-server-session";

const footerLinkClass =
  "rounded-sm text-interactive no-underline hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export async function AppFooter() {
  const session = await getServerSession();

  return (
    <footer
      className="border-t border-hairline px-4 py-8 text-center font-mono text-caption text-muted"
      role="contentinfo"
    >
      <p className="m-0 flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
        {session ? (
          <Link href="/dashboard" className={footerLinkClass}>
            Dashboard
          </Link>
        ) : (
          <Link href="/login" className={footerLinkClass}>
            Sign in
          </Link>
        )}
        <span className="text-faint" aria-hidden>
          ·
        </span>
        <span>Apache License 2.0.</span>
      </p>
    </footer>
  );
}
