import { unlink } from "node:fs/promises";
import type { Pool } from "pg";
import type { ServerEnv } from "@vs/env";
import { claimExpiredListenExportArtifacts } from "@vs/db";
import { resolveExportArtifactAbsolutePath } from "@vs/domain";

export async function runExportArtifactCleanupTick(
  pool: Pool,
  env: ServerEnv,
): Promise<void> {
  const claimed = await claimExpiredListenExportArtifacts(pool, {
    limit: env.EXPORT_ARTIFACT_CLEANUP_BATCH,
  });
  for (const row of claimed) {
    let absolutePath: string;
    try {
      absolutePath = resolveExportArtifactAbsolutePath(
        env.EXPORT_ARTIFACTS_DIR,
        row.deletedArtifactRelativePath,
      );
    } catch (err) {
      console.error(
        `[worker] export cleanup: refusing unsafe artifact path exportJobId=${row.exportJobId} userId=${row.userId}:`,
        err,
      );
      continue;
    }
    try {
      await unlink(absolutePath);
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
      if (code === "ENOENT") {
        continue;
      }
      console.error(
        `[worker] export cleanup: unlink failed exportJobId=${row.exportJobId} path=${absolutePath}:`,
        err,
      );
    }
  }
}
