/**
 * Dashboard segments whose server-rendered trees include listen-derived analytics that
 * should react to coalesced fingerprint / realtime invalidation via `router.refresh()`.
 *
 * Inert shells (export copy, settings forms) skip refresh so background scrobbles do not
 * trigger full RSC reloads while the user is off stats/archive/import surfaces.
 */
export function pathnameAcceptsListenCoalescedRefresh(pathname: string): boolean {
  if (pathname === "/dashboard") {
    return true;
  }
  if (pathname === "/dashboard/explore" || pathname.startsWith("/dashboard/explore/")) {
    return true;
  }
  if (pathname.startsWith("/dashboard/archive")) {
    return true;
  }
  if (pathname.startsWith("/dashboard/imports")) {
    return true;
  }
  return false;
}
