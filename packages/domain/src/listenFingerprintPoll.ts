/**
 * Poll interval for dashboard listen fingerprint (Next.js client + server).
 * Kept in an isolated module so client bundles do not load `node:crypto` via the domain barrel.
 */
export const LISTEN_FINGERPRINT_POLL_MS = 20_000 as const;
