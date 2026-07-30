import Link from "next/link";
import type { ReactNode } from "react";
import {
  signupAccessMainClassName,
  signupAccessPageHeaderClassName,
  signupAuthPageStackClassName,
} from "@/app/access-layout";
import { PublicListeningAuthNavPrefix } from "@/components/public-site-header-nav";

type Props = {
  overline: string;
  title: string;
  children: ReactNode;
};

export async function AuthAccessPage({ overline, title, children }: Props) {
  return (
    <main className={signupAccessMainClassName}>
      <div className={signupAuthPageStackClassName}>
        <header className={signupAccessPageHeaderClassName}>
          <div className="space-y-3">
            <p className="font-mono text-label uppercase tracking-[0.08em] text-overline">{overline}</p>
            <h1 className="font-display text-display-md text-display">{title}</h1>
          </div>
          <nav className="font-mono text-caption uppercase tracking-[0.06em] text-muted">
            <PublicListeningAuthNavPrefix />
            <Link href="/" className="text-interactive no-underline hover:underline">
              Home
            </Link>
          </nav>
        </header>
        {children}
      </div>
    </main>
  );
}
