import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCT_NAME } from "@vs/domain";
import { loadServerEnv } from "@vs/env";
import homeStyles from "@/app/home-landing.module.css";
import { AppBrandMark } from "@/components/app-brand-mark";
import { AppPrimaryNav } from "@/app/dashboard/app-primary-nav";
import { getServerSession } from "@/server/auth/get-server-session";

export const metadata: Metadata = {
  title: `The Covenant — ${PRODUCT_NAME}`,
  description:
    `${PRODUCT_NAME}'s commitment to your privacy: we do not sell your data, and we build the product around your control of your listening history.`,
};

export default async function CovenantPage() {
  const session = await getServerSession();
  const signupsDisabled = loadServerEnv().FEATURE_FLAGS.signupsDisabled;
  const settingsHref = session
    ? "/dashboard/settings"
    : "/login?next=%2Fdashboard%2Fsettings";

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-foreground">
      <header className="border-b border-hairline px-6 py-6 md:py-8">
        <div className="mx-auto flex min-w-0 max-w-app-content items-center justify-between gap-4">
          <Link
            href="/"
            className={`${homeStyles.brandLine} shrink-0 text-inherit no-underline hover:no-underline hover:opacity-90`}
          >
            <AppBrandMark />
            <span className={homeStyles.brandName}>{PRODUCT_NAME}</span>
          </Link>
          {session ? (
            <AppPrimaryNav />
          ) : (
            <nav
              className="flex shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-2 font-mono text-caption uppercase tracking-[0.06em] text-muted"
              aria-label="Site"
            >
              <Link href="/login" className="text-interactive no-underline hover:underline">
                Sign in
              </Link>
              {signupsDisabled ? null : (
                <>
                  <span className="text-faint" aria-hidden>
                    /
                  </span>
                  <Link href="/setup" className="text-interactive no-underline hover:underline">
                    Sign up
                  </Link>
                </>
              )}
            </nav>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full min-w-0 max-w-app-content flex-1 flex-col gap-10 px-6 py-12 md:py-16">
        <header className="max-w-full space-y-3">
          <h1 className="font-display text-display-md text-display">The Covenant</h1>
          <p className="font-sans text-body text-muted">
            This is our plain-language promise about how we treat your account and your listening
            history. It sits alongside our legal policies; when something has to be precise, the
            legal text wins — but we want you to know what we believe in without a law degree.
          </p>
        </header>

        <article className="max-w-full divide-y divide-hairline font-sans text-body text-foreground">
          <section className="space-y-3 pb-10 pt-0" aria-labelledby="covenant-yours">
            <h2 id="covenant-yours" className="font-display text-heading text-display">
              Your history stays yours
            </h2>
            <p className="m-0 text-muted">
              You brought your listening story here. We host it so you can explore it — not so we
              can strip-mine it. You can export what you put in, and you can delete your account and
              associated data when you are done with us.
            </p>
          </section>

          <section className="space-y-3 py-10" aria-labelledby="covenant-no-sale">
            <h2 id="covenant-no-sale" className="font-display text-heading text-display">
              We do not sell your data
            </h2>
            <p className="m-0 text-muted">
              We do not sell your personal information or listening history to data brokers,
              advertisers, or other companies so they can profile you elsewhere. We are not building
              a side business in audience resale.
            </p>
          </section>

          <section className="space-y-3 py-10" aria-labelledby="covenant-purpose">
            <h2 id="covenant-purpose" className="font-display text-heading text-display">
              We use data to run the product, not to surprise you
            </h2>
            <p className="m-0 text-muted">
              We collect and retain what we need to operate {PRODUCT_NAME}: authentication, imports,
              features you use, reliability, abuse prevention, and support when you write in. We use
              reputable infrastructure providers to host the service; they process data on our
              instructions, not for their own advertising products aimed at your listening file.
            </p>
          </section>

          <section className="space-y-3 py-10" aria-labelledby="covenant-security">
            <h2 id="covenant-security" className="font-display text-heading text-display">
              We take security seriously
            </h2>
            <p className="m-0 text-muted">
              We work to protect accounts and stored data with sensible technical and operational
              practices. No online service can promise perfection; we can promise that protecting
              your information is part of the job, not an afterthought.
            </p>
          </section>

          <section className="space-y-3 py-10" aria-labelledby="covenant-changes">
            <h2 id="covenant-changes" className="font-display text-heading text-display">
              If this ever changes, you will hear it from us
            </h2>
            <p className="m-0 text-muted">
              The spirit of this page is simple: respect for your privacy and your control. If we
              materially change how we treat personal data, we will communicate that clearly and
              give you a fair path to export or leave — not bury it in a silent checkbox.
            </p>
          </section>

          <p className="m-0 py-10 font-mono text-caption uppercase tracking-[0.06em] text-muted">
            Questions? Account-related requests can go through{" "}
            <Link href={settingsHref} className="text-interactive no-underline hover:underline">
              Settings
            </Link>
            {session ? "." : " after you sign in."} For anything else, use the support contact we
            publish for {PRODUCT_NAME}.
          </p>
        </article>
      </main>
    </div>
  );
}
