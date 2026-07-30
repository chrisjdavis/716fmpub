import Link from "next/link";
import {
  DELETE_USER_ACCOUNT_CONFIRM_PHRASE,
  getPool,
  getUserProfileFields,
  PURGE_USER_LISTEN_DATA_CONFIRM_PHRASE,
  syncOnboardingProgressFromImports,
} from "@vs/db";
import { sanitizeUserFacingPlainText } from "@vs/domain";
import { loadServerEnv } from "@vs/env";
import { redirect } from "next/navigation";
import { getServerSession } from "@/server/auth/get-server-session";
import { redirectIfDashboardShellLocked } from "@/server/dashboard-shell-lock";
import { SettingsTabsLayout } from "./settings-tabs-layout";

export default async function SettingsPage() {
  const session = await getServerSession();
  if (!session) {
    redirect("/login?next=%2Fdashboard%2Fsettings");
  }

  const env = loadServerEnv();
  const pool = getPool(env);
  await redirectIfDashboardShellLocked(pool, session);
  await syncOnboardingProgressFromImports(pool, session.id);
  const profile = await getUserProfileFields(pool, session.id);

  const profileInitial = {
    displayName: sanitizeUserFacingPlainText(profile?.display_name ?? ""),
    lastfmUsername: sanitizeUserFacingPlainText(profile?.lastfm_username ?? ""),
    hasLastfmApiKey: profile?.has_lastfm_api_key ?? false,
    statsTimezone: profile?.stats_timezone ?? null,
    listeningHistoryPublic: profile?.listening_history_public ?? false,
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="px-6 pb-20 pt-10 md:pb-28 md:pt-14">
        <div className="mx-auto flex max-w-app-content flex-col gap-10 text-left md:gap-12">
          <header className="w-full space-y-4">
            <p className="font-mono text-label uppercase tracking-[0.1em] text-overline">Settings</p>
            <h1 className="font-display text-display-md text-display">Control center</h1>
            <p className="font-sans text-body text-muted">
              How we handle your account, exports, and deletion is summarized in the{" "}
              <Link
                href="/privacy"
                className="text-interactive underline-offset-2 hover:underline"
                prefetch={false}
              >
                Privacy policy
              </Link>
              .
            </p>
          </header>

          <SettingsTabsLayout
            profileInitial={profileInitial}
            currentEmail={session.email}
            emailVerified={session.emailVerified}
            listenDataConfirmPhrase={PURGE_USER_LISTEN_DATA_CONFIRM_PHRASE}
            accountDeleteConfirmPhrase={DELETE_USER_ACCOUNT_CONFIRM_PHRASE}
          />
        </div>
      </div>
    </main>
  );
}
