import { NextResponse } from "next/server";
import {
  computeListenExportArtifactAccess,
  getExportJobByIdForUser,
  getPool,
} from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { exportJobIdPathParamSchema } from "@/server/api/auth-account-input-schemas";
import { emailVerificationRequiredUnlessSatisfied } from "@/server/api/email-verification-api-gate";
import { withApiSession } from "@/server/api/require-session";
import { EXPORT_LISTEN_NO_REFERRER_HEADERS } from "@/server/export-listen-referrer-policy";

/** Suggested client poll interval (ms); not a latency guarantee. */
const EXPORT_LISTEN_STATUS_POLL_AFTER_MS = 1200;
/** Soft cap for client poll iterations; server does not enforce. */
const EXPORT_LISTEN_STATUS_MAX_POLLS_HINT = 200;

export async function GET(
  req: Request,
  context: { params: Promise<{ exportJobId: string }> },
): Promise<Response> {
  return withApiSession(req, async ({ user }) => {
    const denied = emailVerificationRequiredUnlessSatisfied(user);
    if (denied) {
      return denied;
    }
    const { exportJobId } = await context.params;
    const idParsed = exportJobIdPathParamSchema.safeParse(exportJobId);
    if (!idParsed.success) {
      return NextResponse.json(
        { error: "Invalid export job id" },
        { status: 400, headers: EXPORT_LISTEN_NO_REFERRER_HEADERS },
      );
    }

    const env = loadServerEnv();
    const pool = getPool(env);
    const row = await getExportJobByIdForUser(pool, {
      exportJobId: idParsed.data,
      userId: user.id,
    });
    if (!row) {
      return NextResponse.json(
        { error: "Export job not found" },
        { status: 404, headers: EXPORT_LISTEN_NO_REFERRER_HEADERS },
      );
    }

    const artifactAccess = computeListenExportArtifactAccess(row);
    const download =
      artifactAccess === "available" && row.artifactDeliveryToken
        ? {
            href: `/api/export/listens/${encodeURIComponent(row.id)}/download`,
            token: row.artifactDeliveryToken,
          }
        : null;

    return NextResponse.json(
      {
        id: row.id,
        stage: row.stage,
        format: row.format,
        bullmqJobId: row.bullmqJobId,
        errorMessage: row.errorMessage,
        itemsProcessed: row.itemsProcessed,
        itemsTotal: row.itemsTotal,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        artifactExpiresAt: row.artifactExpiresAt,
        artifactAccess,
        download,
        pollAfterMs: EXPORT_LISTEN_STATUS_POLL_AFTER_MS,
        maxPollsHint: EXPORT_LISTEN_STATUS_MAX_POLLS_HINT,
        statusNote:
          "Progress fields (`itemsProcessed`, `itemsTotal`) are read from Postgres for this export job. `itemsTotal` stays null until the worker finishes and records the final count; do not infer totals from BullMQ. artifactAccess=available means the ZIP is within its server-side retention window and may be downloaded with `Authorization: Bearer <download.token>` against `download.href` (scoped to this job and user session); after expiry the job becomes expired, the file is removed by the worker, and downloads return HTTP 410.",
      },
      { headers: EXPORT_LISTEN_NO_REFERRER_HEADERS },
    );
  });
}
