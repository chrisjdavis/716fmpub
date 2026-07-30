import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  countListensForUser,
  getPool,
  getSoleOwnerPublicListeningAccess,
  resolveDashboardAnalyticsBundleRead,
} from "@vs/db";
import { PRODUCT_NAME, sanitizeUserFacingPlainText } from "@vs/domain";
import { loadServerEnv } from "@vs/env";
import { AppBrandMark } from "@/components/app-brand-mark";
import { PublicHomeTopbarActions } from "@/components/public-site-header-nav";
import { getServerSession } from "@/server/auth/get-server-session";
import { isInstanceConfigured } from "@/server/instance-configured";
import {
  PUBLIC_ARCHIVE_PATH,
  PUBLIC_EXPLORE_PATH,
} from "@/server/listening-surface-routes";
import styles from "./home-landing.module.css";

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description:
    "Self-hosted Last.fm listening analytics. One owner account, full archive control.",
};

type HomeShellProps = Readonly<{
  children: React.ReactNode;
  /** First-run only — Set up may appear in the topbar. */
  showSetupInHeader?: boolean;
}>;

function HomeShell({ children, showSetupInHeader = false }: HomeShellProps) {
  return (
    <div className={styles.page}>
      <header className={styles.shellOuter}>
        <div className={`${styles.shellInner} ${styles.specTopbar}`}>
          <Link
            href="/"
            className={`${styles.brandLine} text-inherit no-underline hover:no-underline hover:opacity-90`}
          >
            <AppBrandMark />
            <span className={styles.brandName}>{PRODUCT_NAME}</span>
          </Link>
          <div className={styles.specTopbarActions}>
            <PublicHomeTopbarActions
              linkClassName={styles.specTopLink}
              setupHref={showSetupInHeader ? "/setup" : undefined}
            />
          </div>
        </div>
      </header>

      <main className={styles.shellOuter}>
        <div className={`${styles.shellInner} ${styles.specMain}`}>{children}</div>
      </main>
    </div>
  );
}

function formatListenCount(n: number): string {
  return n.toLocaleString("en-US");
}

export default async function HomePage() {
  const session = await getServerSession();
  if (session) {
    redirect("/dashboard");
  }

  const configured = await isInstanceConfigured();

  if (!configured) {
    return (
      <HomeShell showSetupInHeader>
        <div className={styles.specLayoutGrid}>
          <section className={styles.specHeroSection} aria-labelledby="hero-title">
            <div className={styles.specHeroLeft}>
              <p className={styles.specKicker}>First run</p>
              <h1 id="hero-title" className={`${styles.specHeadline} ${styles.specHeadlineSentence}`}>
                Create the owner account
              </h1>
              <p className={styles.specSub}>
                This is a single-user instance. Set up once, connect Last.fm, and keep your listening
                history on your own machine — no signup invites or plan gates.
              </p>
              <div className={styles.specHeroActions}>
                <Link href="/setup" className={styles.specCta}>
                  Set up
                </Link>
              </div>
            </div>
          </section>
        </div>
      </HomeShell>
    );
  }

  const env = loadServerEnv();
  const pool = getPool(env);
  const access = await getSoleOwnerPublicListeningAccess(pool);

  if (!access) {
    return (
      <HomeShell>
        <div className={styles.specLayoutGrid}>
          <section className={styles.specHeroSection} aria-labelledby="hero-title">
            <div className={styles.specHeroLeft}>
              <p className={styles.specKicker}>Owner access</p>
              <h1 id="hero-title" className={`${styles.specHeadline} ${styles.specHeadlineSentence}`}>
                Sign in to this instance
              </h1>
              <p className={styles.specSub}>
                Listening history is private. Sign in to open the dashboard, archive, explore, and
                export tools — or enable public Explore and Archive in Settings.
              </p>
              <div className={styles.specHeroActions}>
                <Link href="/login" className={styles.specCta}>
                  Sign in
                </Link>
              </div>
            </div>
          </section>
        </div>
      </HomeShell>
    );
  }

  const [listenCount, bundleRead] = await Promise.all([
    countListensForUser(pool, access.userId),
    resolveDashboardAnalyticsBundleRead(pool, access.userId),
  ]);

  const ownerLabelRaw = access.display_name?.trim() || null;
  const ownerLabel = ownerLabelRaw
    ? sanitizeUserFacingPlainText(ownerLabelRaw)
    : null;

  const archiveTotals =
    bundleRead.status === "fresh" ? bundleRead.bundle.archive_totals : null;
  const displayListenCount =
    archiveTotals != null ? archiveTotals.allTimeScrobbles : listenCount;
  const topArtists =
    bundleRead.status === "fresh"
      ? bundleRead.bundle.ranges.all.summary.top_artists.slice(0, 5).map((a) => ({
          name: sanitizeUserFacingPlainText(a.name),
          plays: a.plays,
        }))
      : [];
  const topArtistFallback =
    archiveTotals?.topArtistName != null
      ? sanitizeUserFacingPlainText(archiveTotals.topArtistName)
      : null;

  return (
    <HomeShell>
      <div className={styles.specLayoutGrid}>
        <section className={styles.specHeroSection} aria-labelledby="hero-title">
          <div className={styles.specHeroLeft}>
            <p className={styles.specKicker}>Public listening</p>
            <h1 id="hero-title" className={`${styles.specHeadline} ${styles.specHeadlineSentence}`}>
              {ownerLabel ? `${ownerLabel}’s listening history` : "Listening history"}
            </h1>
            <p className={styles.specSub}>
              {displayListenCount > 0 ? (
                <>
                  {formatListenCount(displayListenCount)} listens on this instance
                  {topArtistFallback ? (
                    <>
                      {" "}
                      · topped by <span className={styles.specInlineEm}>{topArtistFallback}</span>
                    </>
                  ) : null}
                  . Browse Explore and Archive.
                </>
              ) : (
                <>
                  Public Explore and Archive are on. The archive is still empty — check back after
                  import finishes.
                </>
              )}
            </p>
            <div className={styles.specHeroActions}>
              <Link href={PUBLIC_EXPLORE_PATH} className={styles.specCta}>
                Explore
              </Link>
              <Link href={PUBLIC_ARCHIVE_PATH} className={styles.specCtaSecondary}>
                Archive
              </Link>
            </div>
          </div>
        </section>

        {topArtists.length > 0 ? (
          <div className={styles.specSectionsWrap}>
            <section className={styles.specSection} aria-labelledby="tops-title">
              <h2 id="tops-title" className={styles.specSectionTitle}>
                Top artists
              </h2>
              <p className={styles.specSectionLead}>All-time on this instance</p>
              <ol className={styles.specTeaserList}>
                {topArtists.map((artist, i) => (
                  <li key={`${artist.name}-${i}`} className={styles.specTeaserRow}>
                    <span className={styles.specTeaserIndex}>{String(i + 1).padStart(2, "0")}</span>
                    <span className={styles.specTeaserName}>{artist.name}</span>
                    <span className={styles.specTeaserMeta}>
                      {formatListenCount(artist.plays)} plays
                    </span>
                  </li>
                ))}
              </ol>
              <div className={styles.specHeroActions}>
                <Link href={PUBLIC_EXPLORE_PATH} className={styles.specCtaSecondary}>
                  Open Explore
                </Link>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </HomeShell>
  );
}
