/**
 * MBID normalization shared by dedupe hashing and canonicalization.
 * Returns null when the value is absent or only whitespace (hashing maps null to empty string).
 */
export function normalizeImportMbid(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const t = value.trim().toLowerCase();
  return t === "" ? null : t;
}
