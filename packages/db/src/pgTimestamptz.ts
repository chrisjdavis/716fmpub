/**
 * Normalizes `timestamptz` values from node-pg (typically `Date` or ISO `string`) into JSON-safe strings.
 *
 * **Contract:** Intended for columns the query guarantees are non-null (e.g. `listens.played_at`).
 * `null` / `undefined` fall through to `String(value)` (historical dashboard parity: `"null"`, `"undefined"`).
 * For nullable SQL results, use {@link pgTimestamptzToIsoOrNull} instead.
 */
export function pgTimestamptzToIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    return value;
  }
  return String(value);
}

/**
 * Same normalization as {@link pgTimestamptzToIsoString} for non-nullish inputs, but returns `null`
 * when the driver value is SQL NULL or missing (`null` / `undefined`).
 */
export function pgTimestamptzToIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return pgTimestamptzToIsoString(value);
}
