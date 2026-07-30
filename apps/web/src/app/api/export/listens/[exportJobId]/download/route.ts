import { timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import {
  computeListenExportArtifactAccess,
  getExportJobByIdForUser,
  getPool,
} from "@vs/db";
import { loadServerEnv } from "@vs/env";
import {
  exportZipDisplayFilename,
  resolveExportArtifactAbsolutePath,
} from "@/server/export-download";
import {
  exportArtifactDeliveryTokenQuerySchema,
  exportJobIdPathParamSchema,
} from "@/server/api/auth-account-input-schemas";
import { emailVerificationRequiredUnlessSatisfied } from "@/server/api/email-verification-api-gate";
import { withApiSession } from "@/server/api/require-session";
import { EXPORT_LISTEN_NO_REFERRER_HEADERS } from "@/server/export-listen-referrer-policy";

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
    if (artifactAccess === "expired") {
      return NextResponse.json(
        {
          error: "This export has expired. Start a new export from the dashboard.",
          code: "export_expired",
          stage: row.stage,
        },
        { status: 410, headers: EXPORT_LISTEN_NO_REFERRER_HEADERS },
      );
    }
    if (artifactAccess !== "available" || !row.artifactRelativePath) {
      return NextResponse.json(
        {
          error: "Export is not ready for download",
          code: "export_not_ready",
          stage: row.stage,
        },
        { status: 409, headers: EXPORT_LISTEN_NO_REFERRER_HEADERS },
      );
    }

    const url = new URL(req.url);
    const rawToken = url.searchParams.get("token");
    if (rawToken === null || rawToken.trim() === "") {
      return NextResponse.json(
        {
          error: "A download token is required. Open the export status page and use the provided download link.",
          code: "export_download_token_required",
        },
        { status: 400, headers: EXPORT_LISTEN_NO_REFERRER_HEADERS },
      );
    }
    const tokenParsed = exportArtifactDeliveryTokenQuerySchema.safeParse(rawToken);
    if (!tokenParsed.success) {
      return NextResponse.json(
        { error: "Invalid download token.", code: "export_download_token_malformed" },
        { status: 400, headers: EXPORT_LISTEN_NO_REFERRER_HEADERS },
      );
    }
    const stored = row.artifactDeliveryToken;
    if (!stored) {
      return NextResponse.json(
        {
          error: "Export download is not available (missing delivery token).",
          code: "export_download_token_missing",
        },
        { status: 503, headers: EXPORT_LISTEN_NO_REFERRER_HEADERS },
      );
    }
    const a = Buffer.from(stored, "utf8");
    const b = Buffer.from(tokenParsed.data, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json(
        {
          error: "That download link is not valid for this export.",
          code: "export_download_token_rejected",
        },
        { status: 403, headers: EXPORT_LISTEN_NO_REFERRER_HEADERS },
      );
    }

    let absolutePath: string;
    try {
      absolutePath = resolveExportArtifactAbsolutePath(
        env.EXPORT_ARTIFACTS_DIR,
        row.artifactRelativePath,
      );
    } catch {
      return NextResponse.json(
        { error: "Invalid export artifact path" },
        { status: 500, headers: EXPORT_LISTEN_NO_REFERRER_HEADERS },
      );
    }

    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(absolutePath);
    } catch {
      return NextResponse.json(
        {
          error: "Export file is missing on disk",
          code: "export_artifact_missing",
        },
        { status: 503, headers: EXPORT_LISTEN_NO_REFERRER_HEADERS },
      );
    }
    if (!st.isFile()) {
      return NextResponse.json(
        { error: "Export artifact is not a file" },
        { status: 500, headers: EXPORT_LISTEN_NO_REFERRER_HEADERS },
      );
    }

    const utcYmd = row.createdAt.slice(0, 10);
    const zipName = exportZipDisplayFilename(utcYmd, row.format);
    const disposition = `attachment; filename="${zipName}"`;

    const body = Readable.toWeb(createReadStream(absolutePath)) as ReadableStream<Uint8Array>;

    return new NextResponse(body, {
      headers: {
        ...EXPORT_LISTEN_NO_REFERRER_HEADERS,
        "Content-Type": "application/zip",
        "Content-Disposition": disposition,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
