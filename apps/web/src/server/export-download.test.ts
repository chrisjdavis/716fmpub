import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportZipDisplayFilename, resolveExportArtifactAbsolutePath } from "./export-download.js";

describe("export-download helpers", () => {
  it("builds a stable display filename", () => {
    expect(exportZipDisplayFilename("2026-04-15", "json")).toBe("716fm-listens-2026-04-15-json.zip");
  });

  it("resolves paths contained under the base directory", () => {
    expect(resolveExportArtifactAbsolutePath("/data/exports", "u1/e1.zip")).toBe(
      path.resolve("/data/exports", "u1/e1.zip"),
    );
  });

  it("rejects traversal outside the base directory", () => {
    expect(() =>
      resolveExportArtifactAbsolutePath("/data/exports", "../outside/evil.zip"),
    ).toThrow(/invalid export artifact path/);
  });
});
