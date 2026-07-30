import Link from "next/link";
import { PRODUCT_NAME } from "@vs/domain";
import homeStyles from "@/app/home-landing.module.css";
import { AppBrandMark } from "@/components/app-brand-mark";
import { PublicSiteHeaderNav } from "@/components/public-site-header-nav";

export function PublicListeningUnavailable({
  title = "Listening history is private",
}: Readonly<{ title?: string }>) {
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="px-6 pb-20 pt-10 md:pb-28 md:pt-14">
        <div className="mx-auto flex max-w-app-content flex-col gap-6">
          <p className="font-mono text-label uppercase tracking-[0.1em] text-overline">Public</p>
          <h1 className="font-display text-display-md text-display">{title}</h1>
          <p className="max-w-[55ch] font-sans text-body text-muted">
            The owner has not published Explore and Archive on this instance. Sign in if you have
            an account, or ask the owner to enable public listening history in Settings.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              href="/login"
              className="inline-flex h-10 items-center justify-center rounded-md border border-brand bg-brand px-4 font-sans text-base font-medium text-neutral-950 no-underline hover:no-underline"
            >
              Sign in
            </Link>
            <Link
              href="/"
              className="inline-flex h-10 items-center justify-center rounded-md border border-hairline px-4 font-sans text-base font-medium text-foreground no-underline hover:bg-raised hover:no-underline"
            >
              Home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

export function PublicListeningNotReady() {
  return (
    <div className="rounded-md border border-hairline bg-surface px-6 py-8">
      <p className="font-sans text-body text-muted">
        The public archive is not ready yet. Check back after the owner finishes importing listening
        history.
      </p>
    </div>
  );
}

export async function PublicListeningShell({
  children,
  active,
}: Readonly<{
  children: React.ReactNode;
  active: "explore" | "archive";
}>) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-hairline px-6 py-6 md:py-8">
        <div className="mx-auto flex min-w-0 max-w-app-content items-center justify-between gap-4">
          <Link
            href="/"
            className={`${homeStyles.brandLine} shrink-0 text-inherit no-underline hover:no-underline hover:opacity-90`}
          >
            <AppBrandMark />
            <span className={homeStyles.brandName}>{PRODUCT_NAME}</span>
          </Link>
          <PublicSiteHeaderNav active={active} variant="rail" />
        </div>
      </header>
      {children}
    </div>
  );
}
