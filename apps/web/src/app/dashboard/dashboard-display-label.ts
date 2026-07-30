/**
 * Last.fm (and upstream parsers) can persist empty artist/track strings. Empty DOM
 * nodes collapse in flex rows and look like a broken layout — use a sentinel instead.
 */
export function displayLabel(value: string | null | undefined, emptySentinel: string): string {
  const t = (value ?? "").trim();
  return t.length > 0 ? t : emptySentinel;
}
