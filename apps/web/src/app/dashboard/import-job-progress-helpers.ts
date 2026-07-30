/**
 * `items_total === 0` is a known total (not "partial"); bar only when total is positive.
 */
export function importJobItemsTotalKnown(
  items_total: number | null | undefined,
): items_total is number {
  return (
    items_total !== null &&
    items_total !== undefined &&
    Number.isFinite(items_total) &&
    items_total >= 0
  );
}

export function importJobShowsSegmentedProgressBar(
  items_total: number | null | undefined,
): items_total is number {
  return importJobItemsTotalKnown(items_total) && items_total > 0;
}
