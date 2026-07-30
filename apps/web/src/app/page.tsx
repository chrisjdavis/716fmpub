import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCT_NAME } from "@vs/domain";
import { AppBrandMark } from "@/components/app-brand-mark";
import { getServerSession } from "@/server/auth/get-server-session";
import { isInstanceConfigured } from "@/server/instance-configured";
import { AppPrimaryNav } from "@/app/dashboard/app-primary-nav";
import { HomeHowItWorks } from "./home-how-it-works";
import { HomeLandingScrollReveal } from "./home-landing-scroll-reveal";
import styles from "./home-landing.module.css";

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description:
    "Self-hosted Last.fm listening analytics. Import your history, explore it, and keep full control of your data.",
};

export default async function HomePage() {
  const session = await getServerSession();
  const configured = await isInstanceConfigured();
  const primaryHref = session
    ? "/dashboard"
    : configured
      ? "/login"
      : "/setup";
  const primaryLabel = session ? "Open dashboard" : configured ? "Sign in" : "Set up";

  return (
    <div className={styles.page} data-landing-reveal-root>
      <div className={styles.scrollReadLine} aria-hidden />
      <HomeLandingScrollReveal />
      <header
        className={
          session
            ? `${styles.shellOuter} border-b border-hairline py-6 md:py-8`
            : styles.shellOuter
        }
      >
        {session ? (
          <div
            className={`${styles.shellInner} flex min-w-0 items-center justify-between gap-4`}
          >
            <Link
              href="/"
              className={`${styles.brandLine} shrink-0 text-inherit no-underline hover:no-underline hover:opacity-90`}
            >
              <AppBrandMark />
              <span className={styles.brandName}>{PRODUCT_NAME}</span>
            </Link>
            <AppPrimaryNav />
          </div>
        ) : (
          <div className={`${styles.shellInner} ${styles.specTopbar}`}>
            <Link
              href="/"
              className={`${styles.brandLine} text-inherit no-underline hover:no-underline hover:opacity-90`}
            >
              <AppBrandMark />
              <span className={styles.brandName}>{PRODUCT_NAME}</span>
            </Link>
            <div className={styles.specTopbarActions}>
              <Link href={primaryHref} className={styles.specTopLink}>
                {primaryLabel}
              </Link>
            </div>
          </div>
        )}
      </header>

      <main className={styles.shellOuter}>
        <div className={`${styles.shellInner} ${styles.specMain}`}>
          <div className={styles.specLayoutGrid}>
            <section
              className={styles.specHeroSection}
              aria-labelledby="hero-title"
              data-landing-reveal
            >
              <div className={styles.specHeroLeft}>
                <h1 id="hero-title" className={`${styles.specHeadline} ${styles.specHeadlineSentence}`}>
                  Own your music history
                </h1>
                <p className={styles.specSub}>
                  Self-hosted Last.fm listening analytics. Import your archive, explore it, and keep
                  full control on your own machine.
                </p>
                <div className={styles.specHeroActions}>
                  <Link href={primaryHref} className={styles.specCta}>
                    {primaryLabel}
                  </Link>
                  <Link href="#how-it-works" className={styles.specCtaSecondary}>
                    See how it works
                  </Link>
                </div>
              </div>
            </section>

            <div className={styles.specSectionsWrap}>
              <section
                className={styles.specSection}
                aria-labelledby="why-title"
                data-landing-reveal
              >
                <h2 id="why-title" className={styles.specSectionTitle}>
                  Single-user, open source, all features unlocked.
                </h2>
                <p className={styles.specSectionBody}>
                  One local account. No signup invites, no admin console, no plan gates. Connect
                  Last.fm, import scrobbles, and use the full dashboard, archive, explore, and export
                  tools.
                </p>
              </section>

              <section
                className={styles.specSection}
                id="how-it-works"
                aria-labelledby="how-title"
                data-landing-reveal
              >
                <h2 id="how-title" className={styles.specSectionTitle}>
                  How it works
                </h2>
                <HomeHowItWorks />
              </section>

              <section
                className={styles.specSection}
                aria-labelledby="final-cta-title"
                data-landing-reveal
              >
                <h2 id="final-cta-title" className={styles.specSectionTitle}>
                  Bring your history somewhere that respects it.
                </h2>
                <Link href={primaryHref} className={styles.specCta}>
                  {primaryLabel}
                </Link>
              </section>
            </div>
          </div>
        </div>
      </main>

      <footer className={`${styles.shellOuter} ${styles.specFooter}`} aria-label="Site links">
        <div className={`${styles.shellInner} ${styles.specFooterInner}`}>
          <nav className={styles.specFooterNav} aria-label="Legal">
            <Link href="/covenant" className={styles.specFooterLink}>
              Data & privacy
            </Link>
            <Link href="/terms" className={styles.specFooterLink}>
              Terms
            </Link>
            <Link href="/privacy" className={styles.specFooterLink}>
              Privacy
            </Link>
          </nav>
          <p className={styles.specFooterMeta}>{PRODUCT_NAME}</p>
        </div>
      </footer>
    </div>
  );
}
