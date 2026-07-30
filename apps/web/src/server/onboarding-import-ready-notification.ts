import type { Pool } from "pg";
import { isOnboardingInitialImportProcessingComplete } from "@vs/db";
import type { ServerEnv } from "@vs/env";
import { getWebTransactionalMailer } from "@/server/transactional-mailer";

function dashboardUrlForUser(env: ServerEnv): string | null {
  const origin = env.publicAppOrigin?.trim().replace(/\/+$/, "");
  if (!origin) {
    return null;
  }
  return `${origin}/dashboard`;
}

/**
 * Idempotent: sends at most once per user when guided import processing is fully done.
 * Used from the internal worker webhook and opportunistically after onboarding state reads.
 */
export async function trySendOnboardingImportReadyNotificationBestEffort(
  pool: Pool,
  env: ServerEnv,
  userId: string,
): Promise<void> {
  const dashboardUrl = dashboardUrlForUser(env);
  if (!dashboardUrl) {
    return;
  }
  const processingComplete = await isOnboardingInitialImportProcessingComplete(pool, userId);
  if (!processingComplete) {
    return;
  }

  const { rows } = await pool.query<{
    email: string;
    email_verified_at: string | null;
    sent_at: string | null;
  }>(
    `select email, email_verified_at, onboarding_import_ready_email_sent_at as sent_at
     from users
     where id = $1::uuid
     limit 1`,
    [userId],
  );
  const row = rows[0];
  if (!row?.email || row.email_verified_at === null || row.sent_at !== null) {
    return;
  }

  const mailer = getWebTransactionalMailer();
  if (!mailer) {
    return;
  }

  await mailer.sendOnboardingImportReady({
    to: row.email,
    dashboardUrl,
  });

  await pool.query(
    `update users
     set onboarding_import_ready_email_sent_at = now(),
         updated_at = now()
     where id = $1::uuid
       and onboarding_import_ready_email_sent_at is null`,
    [userId],
  );
}
