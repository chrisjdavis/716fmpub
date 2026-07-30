import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  unlink: vi.fn(),
}));

vi.mock("@vs/db", () => ({
  claimExpiredListenExportArtifacts: vi.fn(),
}));

import { unlink } from "node:fs/promises";
import { claimExpiredListenExportArtifacts } from "@vs/db";
import { resolveExportArtifactAbsolutePath } from "@vs/domain";
import { runExportArtifactCleanupTick } from "./runExportArtifactCleanupTick.js";

const USER = "11111111-1111-4111-8111-111111111111";
const EXPORT = "22222222-2222-4222-8222-222222222222";

describe("runExportArtifactCleanupTick", () => {
  const pool = {} as never;
  const env = {
    EXPORT_ARTIFACTS_DIR: "/tmp/vs-exports",
    EXPORT_ARTIFACT_CLEANUP_BATCH: 50,
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unlinks files for claimed expired artifact paths", async () => {
    vi.mocked(claimExpiredListenExportArtifacts).mockResolvedValue([
      {
        exportJobId: EXPORT,
        userId: USER,
        deletedArtifactRelativePath: `${USER}/${EXPORT}.zip`,
      },
    ]);
    await runExportArtifactCleanupTick(pool, env);
    expect(claimExpiredListenExportArtifacts).toHaveBeenCalledWith(pool, { limit: 50 });
    expect(unlink).toHaveBeenCalledWith(
      resolveExportArtifactAbsolutePath("/tmp/vs-exports", `${USER}/${EXPORT}.zip`),
    );
  });

  it("ignores ENOENT when the file was already removed", async () => {
    vi.mocked(claimExpiredListenExportArtifacts).mockResolvedValue([
      {
        exportJobId: EXPORT,
        userId: USER,
        deletedArtifactRelativePath: `${USER}/${EXPORT}.zip`,
      },
    ]);
    vi.mocked(unlink).mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    await expect(runExportArtifactCleanupTick(pool, env)).resolves.toBeUndefined();
  });
});
