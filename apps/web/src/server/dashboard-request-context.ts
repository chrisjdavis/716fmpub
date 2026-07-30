import { AsyncLocalStorage } from "node:async_hooks";

type DashboardRequestContext = {
  /** Per-HTTP-navigation nonce; scopes in-flight analytics bundle reads. */
  requestNonce: string;
};

const dashboardRequestAsyncLocalStorage = new AsyncLocalStorage<DashboardRequestContext>();

const bundleReadPromisesByNonce = new Map<string, Map<string, Promise<unknown>>>();

/**
 * Runs `fn` with dashboard request context so analytics bundle reads can dedupe across the main
 * loader and deferred RSC chunks for the same navigation.
 */
export async function withDashboardRequestContext<T>(fn: () => Promise<T>): Promise<T> {
  const requestNonce = crypto.randomUUID();
  bundleReadPromisesByNonce.set(requestNonce, new Map());
  try {
    return await dashboardRequestAsyncLocalStorage.run({ requestNonce }, fn);
  } finally {
    bundleReadPromisesByNonce.delete(requestNonce);
  }
}

export function getOrCreateBundleReadPromiseForUser<T>(
  userId: string,
  create: () => Promise<T>,
): Promise<T> {
  const ctx = dashboardRequestAsyncLocalStorage.getStore();
  if (!ctx) {
    return create();
  }
  const byUser = bundleReadPromisesByNonce.get(ctx.requestNonce);
  if (!byUser) {
    return create();
  }
  const existing = byUser.get(userId) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }
  const created = create();
  byUser.set(userId, created);
  return created;
}
