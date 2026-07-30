import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  countListensForUser,
  getPool,
  getSoleOwnerPublicListeningAccess,
  tryReadDashboardAnalyticsBundleAllowStale,
  type DashboardAnalyticsBundleBodyV1,
} from "@vs/db";
import { PRODUCT_NAME, sanitizeUserFacingPlainText } from "@vs/domain";
import { loadServerEnv } from "@vs/env";
import { AppBrandMark } from "@/components/app-brand-mark";
import { PublicHomeTopbarActions } from "@/components/public-site-header-nav";
import { displayUtcWeekdayPeak } from "@/app/dashboard/dashboard-window-behavior";
import { formatCount } from "@/app/dashboard/format-count";
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

type PublicHomeMetricCard = Readonly<{
  kicker: string;
  title: string;
  detail: string | null;
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

function firstListenUtcYear(iso: string | null): number | null {
  if (!iso) {
    return null;
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms).getUTCFullYear();
}

/**
 * Lightweight public teaser of the same metric card shapes as logged-in home
 * (peak day / most replayed / top album / recent volume) — no AI briefing.
 */
function buildPublicHomeMetricCards(
  bundle: DashboardAnalyticsBundleBodyV1,
): readonly PublicHomeMetricCard[] {
  const cards: PublicHomeMetricCard[] = [];
  const allSlot = bundle.ranges.all;
  const weekSlot = bundle.ranges["7d"];
  const weekTotal = weekSlot.summary.total_scrobbles;
  const allSummary = allSlot.summary;

  if (weekTotal > 0) {
    cards.push({
      kicker: "Last 7 days",
      title: formatCount(weekTotal),
      detail: "Plays in the rolling week",
    });
  }

  const peak = displayUtcWeekdayPeak(allSlot.heroWindow.weekday_peak);
  if (peak) {
    cards.push({
      kicker: "Peak day",
      title: peak.name,
      detail: `${formatCount(peak.count)} plays on that weekday (UTC)`,
    });
  }

  const topTrack = allSummary.top_tracks[0];
  if (topTrack && topTrack.plays > 0) {
    cards.push({
      kicker: "Most replayed",
      title: sanitizeUserFacingPlainText(topTrack.title),
      detail: `${sanitizeUserFacingPlainText(topTrack.artist_name)} · ${formatCount(topTrack.plays)} plays`,
    });
  }

  const topAlbum = allSummary.top_albums[0];
  if (topAlbum && topAlbum.plays > 0 && cards.length < 4) {
    cards.push({
      kicker: "Top album",
      title: sanitizeUserFacingPlainText(topAlbum.title),
      detail: `${sanitizeUserFacingPlainText(topAlbum.artist_name)} · ${formatCount(topAlbum.plays)} plays`,
    });
  }

  const sinceYear = firstListenUtcYear(bundle.archive_totals.firstListenAt);
  if (sinceYear != null && cards.length < 4) {
    cards.push({
      kicker: "Listening since",
      title: String(sinceYear),
      detail: "First play in this archive",
    });
  }

  return cards.slice(0, 4);
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

  const [listenCount, bundle] = await Promise.all([
    countListensForUser(pool, access.userId),
    // Allow stale: public teaser should still show metrics between recomputes.
    tryReadDashboardAnalyticsBundleAllowStale(pool, access.userId),
  ]);

  const ownerLabelRaw = access.display_name?.trim() || null;
  const ownerLabel = ownerLabelRaw
    ? sanitizeUserFacingPlainText(ownerLabelRaw)
    : null;

  const archiveTotals = bundle?.archive_totals ?? null;
  const displayListenCount =
    archiveTotals != null ? archiveTotals.allTimeScrobbles : listenCount;
  const metricCards = bundle != null ? buildPublicHomeMetricCards(bundle) : [];
  const topArtists =
    bundle != null
      ? bundle.ranges.all.summary.top_artists.slice(0, 5).map((a) => ({
          name: sanitizeUserFacingPlainText(a.name),
          plays: a.plays,
        }))
      : [];
  const topArtistFallback =
    archiveTotals?.topArtistName != null
      ? sanitizeUserFacingPlainText(archiveTotals.topArtistName)
      : null;
  const hasBodySections = metricCards.length > 0 || topArtists.length > 0;

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
                  {formatCount(displayListenCount)} listens on this instance
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

        {hasBodySections ? (
          <div className={styles.specSectionsWrap}>
            {metricCards.length > 0 ? (
              <section className={styles.specSection} aria-labelledby="metrics-title">
                <h2 id="metrics-title" className={styles.specSectionTitle}>
                  Listening snapshot
                </h2>
                <p className={styles.specSectionLead}>
                  Recent volume, peak day, and favorites from this archive.
                </p>
                <ul className={styles.specMetricGrid}>
                  {metricCards.map((card) => (
                    <li key={`${card.kicker}-${card.title}`} className={styles.specMetricCard}>
                      <p className={styles.specMetricKicker}>{card.kicker}</p>
                      <p className={styles.specMetricTitle}>{card.title}</p>
                      {card.detail ? (
                        <p className={styles.specMetricDetail}>{card.detail}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {topArtists.length > 0 ? (
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
                        {formatCount(artist.plays)} plays
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
            ) : null}
          </div>
        ) : null}
      </div>
    </HomeShell>
  );
}
