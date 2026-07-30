import path from "node:path";

/** Default wall-clock lifetime for a completed listen-export ZIP (seconds). */
export const EXPORT_ARTIFACT_RETENTION_SEC_DEFAULT = 604800 as const;

export function resolveExportArtifactAbsolutePath(
  artifactsBaseDir: string,
  artifactRelativePath: string,
): string {
  const base = path.resolve(artifactsBaseDir);
  const resolved = path.resolve(base, artifactRelativePath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error("invalid export artifact path");
  }
  return resolved;
}

export function exportZipDisplayFilename(utcYmd: string, format: "json" | "csv"): string {
  return `716fm-listens-${utcYmd}-${format}.zip`;
}
