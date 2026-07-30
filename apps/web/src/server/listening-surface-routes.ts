/**
 * Default authenticated dashboard routes for Explore / Archive.
 * Public guest surfaces use `/explore` and `/archive` with the same query contracts.
 */
export const DASHBOARD_EXPLORE_PATH = "/dashboard/explore";
export const DASHBOARD_ARCHIVE_PATH = "/dashboard/archive";
export const PUBLIC_EXPLORE_PATH = "/explore";
export const PUBLIC_ARCHIVE_PATH = "/archive";
export const DASHBOARD_ANALYTICS_API_BASE = "/api/analytics";
export const PUBLIC_ANALYTICS_API_BASE = "/api/public/analytics";

export type ListeningSurfaceRoutes = Readonly<{
  explorePath: string;
  archivePath: string;
  analyticsApiBase: string;
}>;

export const DASHBOARD_LISTENING_ROUTES: ListeningSurfaceRoutes = {
  explorePath: DASHBOARD_EXPLORE_PATH,
  archivePath: DASHBOARD_ARCHIVE_PATH,
  analyticsApiBase: DASHBOARD_ANALYTICS_API_BASE,
};

export const PUBLIC_LISTENING_ROUTES: ListeningSurfaceRoutes = {
  explorePath: PUBLIC_EXPLORE_PATH,
  archivePath: PUBLIC_ARCHIVE_PATH,
  analyticsApiBase: PUBLIC_ANALYTICS_API_BASE,
};

export function archiveMonthHref(archivePath: string, monthYyyMm: string): string {
  return `${archivePath}?month=${encodeURIComponent(monthYyyMm)}`;
}

export function exploreMonthHref(
  explorePath: string,
  monthYyyMm: string,
  view?: "new-music" | null,
): string {
  const qs = new URLSearchParams();
  qs.set("month", monthYyyMm);
  if (view === "new-music") {
    qs.set("view", "new-music");
  }
  return `${explorePath}?${qs.toString()}`;
}
