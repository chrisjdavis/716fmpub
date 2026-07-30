/**
 * Derived lifecycle for curated beta invites. Persistence stores facts only
 * (`revoked_at`, `expires_at`, `used_count`, `max_uses`); this helper is the
 * single ordering contract for UI and query filters.
 */
export type BetaInviteLifecycleState =
  | "revoked"
  | "expired"
  | "exhausted"
  | "active";

export function resolveBetaInviteLifecycleState(args: Readonly<{
  revokedAt: Date | string | null;
  expiresAt: Date | string | null;
  usedCount: number;
  maxUses: number;
  nowMs: number;
}>): BetaInviteLifecycleState {
  if (args.revokedAt !== null && args.revokedAt !== undefined) {
    return "revoked";
  }
  if (args.expiresAt !== null && args.expiresAt !== undefined) {
    const expMs =
      args.expiresAt instanceof Date
        ? args.expiresAt.getTime()
        : Date.parse(String(args.expiresAt));
    if (Number.isFinite(expMs) && expMs <= args.nowMs) {
      return "expired";
    }
  }
  if (args.usedCount >= args.maxUses) {
    return "exhausted";
  }
  return "active";
}
