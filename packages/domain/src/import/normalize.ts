/**
 * Normalizes free-text fields from imports for stable canonical keys.
 * NFC, trim, lowercase, and internal whitespace collapsed to a single ASCII space.
 */
export function normalizeImportString(value: string | null | undefined): string {
  if (value == null) {
    return "";
  }
  const nfc = value.normalize("NFC");
  const trimmed = nfc.trim().toLowerCase();
  return trimmed.replace(/\s+/gu, " ");
}
