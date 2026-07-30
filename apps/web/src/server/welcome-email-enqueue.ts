import type { Pool } from "pg";
import { claimWelcomeEmailDispatchSlot, releaseWelcomeEmailDispatchSlot } from "@vs/db";
import type { ServerEnv } from "@vs/env";
import { summarizeThrowableForLog } from "@vs/sensitive";
import { getWebTransactionalMailer } from "./transactional-mailer";

export type WelcomeEmailTriggerPoint = "signup" | "email_verified";

function logWelcomeSkipped(payload: Record<string, unknown>): void {
  console.warn(
    JSON.stringify({
      component: "welcome-email",
      level: "warn",
      event: "welcome_email_skipped",
      ...payload,
    }),
  );
}

/**
 * Sends the inventory welcome email on the shared transactional mailer without blocking
 * the HTTP response. Honors {@link ServerEnv.welcomeEmailTrigger}. Uses
 * {@link claimWelcomeEmailDispatchSlot} so duplicate sends are suppressed.
 */
export function enqueueWelcomeEmailIfConfigured(args: Readonly<{
  env: ServerEnv;
  pool: Pool;
  userId: string;
  when: WelcomeEmailTriggerPoint;
}>): void {
  const trigger = args.env.welcomeEmailTrigger ?? "off";
  if (trigger === "off" || trigger !== args.when) {
    return;
  }
  const origin = args.env.publicAppOrigin?.trim();
  if (!origin) {
    logWelcomeSkipped({
      reason: "public_app_origin_missing",
      userId: args.userId,
      when: args.when,
    });
    return;
  }
  const mailer = getWebTransactionalMailer();
  if (!mailer) {
    logWelcomeSkipped({
      reason: "transactional_mailer_unavailable",
      userId: args.userId,
      when: args.when,
    });
    return;
  }

  const startUrl = new URL("/", origin).toString();

  void (async () => {
    const claimed = await claimWelcomeEmailDispatchSlot(args.pool, args.userId);
    if (!claimed) {
      return;
    }
    try {
      await mailer.sendWelcome({ to: claimed.email, startUrl });
    } catch (err) {
      await releaseWelcomeEmailDispatchSlot(args.pool, args.userId);
      console.error("[welcome-email] send failed:", summarizeThrowableForLog(err));
    }
  })();
}
