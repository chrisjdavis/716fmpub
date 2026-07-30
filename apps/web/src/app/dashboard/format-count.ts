const countFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

/**
 * Integer counts for dashboard copy (thousands separators, en-US).
 * Non-finite values fall back to `String(n)` so callers never throw.
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) {
    return String(n);
  }
  return countFormatter.format(Math.trunc(n));
}
