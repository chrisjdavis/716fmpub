import type { ServerEnv } from "@vs/env";
import { logQueueActivity, summarizeFailure } from "@vs/queue";

import { resolveWebReadCacheInvalidationOrigin } from "./webReadCacheInvalidation.js";

/**
 * Best-effort HTTP call into the Next.js app to email the user when guided onboarding import
 * processing (including stats rollups) is complete. No-ops when origin or internal secret is unset.
 */
export async function notifyWebAppOnboardingImportReadyBestEffort(
  env: ServerEnv,
  userId: string,
): Promise<void> {
  const origin = resolveWebReadCacheInvalidationOrigin(env);
  const secret = env.VS_INTERNAL_API_SECRET;
  if (!origin || !secret || secret.length === 0) {
    return;
  }

  const url = `${origin}/api/internal/onboarding/notify-import-ready`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ user_id: userId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      logQueueActivity({
        level: "warn",
        event: "web_onboarding_import_ready_notify_failed",
        queue: "web_onboarding_import_ready",
        userId,
        detail: {
          http_status: res.status,
          reason: "http_non_2xx",
        },
      });
    }
  } catch (err) {
    logQueueActivity({
      level: "warn",
      event: "web_onboarding_import_ready_notify_failed",
      queue: "web_onboarding_import_ready",
      userId,
      detail: { reason: "fetch_error" },
      failure: summarizeFailure(err),
    });
  }
}
