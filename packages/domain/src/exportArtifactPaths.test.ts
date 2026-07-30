import { describe, expect, it } from "vitest";
import { exportZipDisplayFilename, resolveExportArtifactAbsolutePath } from "./exportArtifactPaths.js";

describe("exportArtifactPaths", () => {
  it("resolveExportArtifactAbsolutePath resolves under the base directory", () => {
    expect(resolveExportArtifactAbsolutePath("/data/exports", "u1/e1.zip")).toBe(
      "/data/exports/u1/e1.zip",
    );
  });

  it("resolveExportArtifactAbsolutePath rejects traversal outside the base", () => {
    expect(() =>
      resolveExportArtifactAbsolutePath("/data/exports", "../outside/evil.zip"),
    ).toThrow(/invalid export artifact path/);
  });

  it("exportZipDisplayFilename includes format", () => {
    expect(exportZipDisplayFilename("2026-01-01", "json")).toBe("716fm-listens-2026-01-01-json.zip");
  });
});
