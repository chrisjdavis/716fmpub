import { NextResponse } from "next/server";
import {
  countListensForUser,
  deriveImportStatusLabel,
  getLatestDashboardImportJobForUser,
  getPool,
  syncOnboardingProgressFromImports,
} from "@vs/db";
import { sanitizeUserFacingPlainText } from "@vs/domain";
import { loadServerEnv } from "@vs/env";
import { withApiSession } from "@/server/api/require-session";
import { loadOnboardingStatePayload } from "@/server/onboarding-state-response";

export async function GET(req: Request): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const env = loadServerEnv();
    const pool = getPool(env);
    await syncOnboardingProgressFromImports(pool, user.id);
    const job = await getLatestDashboardImportJobForUser(pool, user.id);
    const listenCount = await countListensForUser(pool, user.id);
    const importStatus = deriveImportStatusLabel(job);
    const payload = await loadOnboardingStatePayload({ pool, user });
    const percent =
      job?.items_total !== null &&
      job?.items_total !== undefined &&
      job.items_total > 0
        ? Math.min(
            100,
            Math.round((100 * job.items_processed) / job.items_total),
          )
        : null;
    return NextResponse.json({
      state: payload.state,
      import_status: importStatus,
      has_usable_archive_data: payload.hasUsableArchiveData,
      percent,
      listen_count: listenCount,
      message:
        importStatus === "running" || importStatus === "queued"
          ? "We are building your archive in the background."
          : importStatus === "completed"
            ? "Your Last.fm import finished."
            : "Import status",
      latest_milestone:
        job && job.source === "user"
          ? sanitizeUserFacingPlainText(
              `${job.items_processed} batches processed`,
            )
          : null,
      error_message:
        job?.source === "user" && job.error_message
          ? sanitizeUserFacingPlainText(job.error_message)
          : null,
      onboarding: payload,
    });
  });
}
