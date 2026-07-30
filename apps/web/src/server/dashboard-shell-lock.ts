import type { Pool } from "pg";
import {
  getUserOnboardingRow,
  syncOnboardingProgressFromImports,
  type UserOnboardingRow,
} from "@vs/db";
import { redirect } from "next/navigation";
import type { AuthenticatedUser } from "@/server/auth/session";

/**
 * When true, the dashboard shows only email verification (if needed) plus the Last.fm onboarding
 * wizard; other dashboard routes redirect to `/dashboard`.
 */
export function isDashboardShellLocked(
  session: Pick<AuthenticatedUser, "emailVerified">,
  onboardingRow: UserOnboardingRow | null,
): boolean {
  if (!session.emailVerified) {
    return true;
  }
  if (!onboardingRow) {
    return true;
  }
  if (onboardingRow.onboarding_completed_at !== null) {
    return false;
  }
  if (onboardingRow.onboarding_state === "completed") {
    return false;
  }
  return true;
}

export async function evaluateDashboardShellLock(
  pool: Pick<Pool, "query">,
  session: Pick<AuthenticatedUser, "id" | "emailVerified">,
): Promise<Readonly<{ locked: boolean; onboardingRow: UserOnboardingRow | null }>> {
  await syncOnboardingProgressFromImports(pool, session.id);
  const onboardingRow = await getUserOnboardingRow(pool, session.id);
  return {
    locked: isDashboardShellLocked(session, onboardingRow),
    onboardingRow,
  };
}

export async function redirectIfDashboardShellLocked(
  pool: Pick<Pool, "query">,
  session: AuthenticatedUser,
): Promise<void> {
  const { locked } = await evaluateDashboardShellLock(pool, session);
  if (locked) {
    redirect("/dashboard");
  }
}
