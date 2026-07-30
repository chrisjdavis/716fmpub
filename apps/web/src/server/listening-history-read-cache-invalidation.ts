import { invalidateUserScopedReadCaches } from "@/server/user-scoped-ttl-read-cache";

/**
 * Clears server-side read caches for data derived from canonical listens, import/sync state,
 * and related dashboard aggregates. Call after any mutation that can change those read models.
 */
export function invalidateListeningHistoryDerivedReadCaches(userId: string): void {
  invalidateUserScopedReadCaches(userId);
}
