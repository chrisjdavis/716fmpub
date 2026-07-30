/**
 * Browser event emitted when listen-derived server data may have changed (WebSocket
 * `listens_updated` or fingerprint poll delta), after coalescing in
 * {@link DashboardListenFingerprintPoller}. Client surfaces that keep their own copy of
 * listen-related state (e.g. onboarding import progress) should refresh from the API on this
 * signal instead of polling.
 */
export const LISTEN_DATA_INVALIDATION_EVENT = "vs:listens-data-invalidation" as const;

export function dispatchListenDataInvalidation(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(LISTEN_DATA_INVALIDATION_EVENT));
}
