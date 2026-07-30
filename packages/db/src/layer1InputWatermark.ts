/**
 * VS-76 — deterministic Layer 1 per-user **input** watermark from bounded signals:
 * canonical `listens` (played + ingestion time) and terminal `import_jobs` completions.
 *
 * Layer 1 `artist.user_relationship.v1` reads `listens` only; `created_at` catches
 * historical `played_at` backfills. Completed imports are included so post-import
 * idle periods still advance the watermark when canonical rows lag bookkeeping.
 */

export type Layer1InputWatermarkParts = Readonly<{
  maxPlayedAt: Date | null;
  maxListenCreatedAt: Date | null;
  maxImportCompletedAt: Date | null;
}>;

export function mergeLayer1InputWatermarkParts(parts: Layer1InputWatermarkParts): Date | null {
  let best: number | null = null;
  for (const d of [parts.maxPlayedAt, parts.maxListenCreatedAt, parts.maxImportCompletedAt]) {
    if (d == null) {
      continue;
    }
    const t = d.getTime();
    if (best == null || t > best) {
      best = t;
    }
  }
  return best == null ? null : new Date(best);
}

export function layer1InputWatermarksEqual(a: Date | null, b: Date | null): boolean {
  if (a == null && b == null) {
    return true;
  }
  if (a == null || b == null) {
    return false;
  }
  return a.getTime() === b.getTime();
}
